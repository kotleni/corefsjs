import {CoreVFSDriver} from "./corevfs-driver";
import {VFile} from "../vfile";
import {FileDescriptor} from "../file-descriptor";
import {FileStats} from "../filestats";

export class IndexedDBVFSDriver implements CoreVFSDriver {
    private dbName: string;
    private storeName = 'descriptors';
    private contentStoreName = 'content';
    private db: IDBDatabase | null = null;
    private readyPromise: Promise<void>;

    constructor(dbName: string = 'vfs_db') {
        this.dbName = dbName;
        this.readyPromise = this.init();
    }

    private init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'path' });
                }
                if (!db.objectStoreNames.contains(this.contentStoreName)) {
                    db.createObjectStore(this.contentStoreName, { keyPath: 'path' });
                }
            };
        });
    }

    private async getStore(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
        await this.readyPromise;
        if (!this.db) throw new Error("DB not initialized");
        const tx = this.db.transaction(storeName, mode);
        return tx.objectStore(storeName);
    }

    private req<T>(request: IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async createFile(path: string): Promise<VFile | null> {
        await this.readyPromise;
        if (await this.exists(path)) return null;

        const descriptor: FileDescriptor = {
            path: path,
            parent: -1,
            name: path.split('/').pop() || path,
            size: 0,
            isDirectory: false,
            createdAt: Date.now(),
            modifiedAt: Date.now()
        };

        const tx = this.db!.transaction([this.storeName, this.contentStoreName], 'readwrite');

        await Promise.all([
            this.req(tx.objectStore(this.storeName).add(descriptor)),
            this.req(tx.objectStore(this.contentStoreName).add({ path, data: new Uint8Array(0) }))
        ]);

        return { descriptor };
    }

    async removeFile(path: string): Promise<VFile | null> {
        const desc = await this.stat(path);
        if (!desc || desc.isDirectory) return null;

        // Reconstruct VFile from stats for return
        const vFile: VFile = {
            descriptor: {
                path,
                parent: -1,
                name: path.split('/').pop() || path,
                ...desc
            }
        };

        const tx = this.db!.transaction([this.storeName, this.contentStoreName], 'readwrite');
        await Promise.all([
            this.req(tx.objectStore(this.storeName).delete(path)),
            this.req(tx.objectStore(this.contentStoreName).delete(path))
        ]);

        return vFile;
    }

    async createDirectory(path: string): Promise<boolean> {
        if (await this.exists(path)) return false;

        const descriptor: FileDescriptor = {
            path: path,
            parent: -1,
            name: path.split('/').pop() || path,
            size: 0,
            isDirectory: true,
            createdAt: Date.now(),
            modifiedAt: Date.now()
        };

        const store = await this.getStore(this.storeName, 'readwrite');
        await this.req(store.add(descriptor));
        return true;
    }

    async removeDirectory(path: string): Promise<boolean> {
        const desc = await this.stat(path);
        if (!desc || !desc.isDirectory) return false;

        const files = await this.listDirectory(path);
        if (files.length > 0) return false;

        const store = await this.getStore(this.storeName, 'readwrite');
        await this.req(store.delete(path));
        return true;
    }

    async listDirectory(path: string): Promise<VFile[]> {
        const store = await this.getStore(this.storeName, 'readonly');
        const allDescriptors = await this.req<FileDescriptor[]>(store.getAll());

        const cleanPath = path === '/' ? '' : path;

        return allDescriptors
            .filter(d => {
                const parentPath = d.path.substring(0, d.path.lastIndexOf('/'));
                return parentPath === cleanPath && d.path !== cleanPath;
            })
            .map(descriptor => ({ descriptor }));
    }

    async readFile(path: string): Promise<Uint8Array | null> {
        const store = await this.getStore(this.contentStoreName, 'readonly');
        const result = await this.req<{ path: string, data: Uint8Array }>(store.get(path));
        return result ? result.data : null;
    }

    async writeFile(path: string, data: Uint8Array): Promise<boolean> {
        const desc = await this.stat(path);
        if (!desc || desc.isDirectory) return false;

        const tx = this.db!.transaction([this.storeName, this.contentStoreName], 'readwrite');

        // Update content
        const contentStore = tx.objectStore(this.contentStoreName);
        await this.req(contentStore.put({ path, data }));

        // Update meta
        const metaStore = tx.objectStore(this.storeName);
        const meta = await this.req<FileDescriptor>(metaStore.get(path));
        meta.size = data.length;
        meta.modifiedAt = Date.now();
        await this.req(metaStore.put(meta));

        return true;
    }

    async appendFile(path: string, data: Uint8Array): Promise<boolean> {
        const currentData = await this.readFile(path);
        if (currentData === null) return false;

        const newData = new Uint8Array(currentData.length + data.length);
        newData.set(currentData);
        newData.set(data, currentData.length);

        return this.writeFile(path, newData);
    }

    async exists(path: string): Promise<boolean> {
        const store = await this.getStore(this.storeName, 'readonly');
        const count = await this.req(store.count(path));
        return count > 0;
    }

    async stat(path: string): Promise<FileStats | null> {
        const store = await this.getStore(this.storeName, 'readonly');
        const desc = await this.req<FileDescriptor>(store.get(path));
        if (!desc) return null;
        return {
            size: desc.size,
            isDirectory: desc.isDirectory,
            createdAt: desc.createdAt,
            modifiedAt: desc.modifiedAt
        };
    }

    async rename(oldPath: string, newPath: string): Promise<boolean> {
        if (!(await this.exists(oldPath)) || (await this.exists(newPath))) return false;

        // Get all items to move (recursively if dir)
        const store = await this.getStore(this.storeName, 'readonly');
        const all = await this.req<FileDescriptor[]>(store.getAll());

        const toMove = all.filter(d => d.path === oldPath || d.path.startsWith(oldPath + '/'));

        const tx = this.db!.transaction([this.storeName, this.contentStoreName], 'readwrite');
        const metaStore = tx.objectStore(this.storeName);
        const contentStore = tx.objectStore(this.contentStoreName);

        for (const desc of toMove) {
            const suffix = desc.path.substring(oldPath.length);
            const dest = newPath + suffix;

            // Move Descriptor
            const newDesc = { ...desc, path: dest, name: dest.split('/').pop() || dest };
            await this.req(metaStore.delete(desc.path));
            await this.req(metaStore.add(newDesc));

            // Move Content if file
            if (!desc.isDirectory) {
                const content = await this.req<{path: string, data: Uint8Array}>(contentStore.get(desc.path));
                if (content) {
                    await this.req(contentStore.delete(desc.path));
                    await this.req(contentStore.put({ path: dest, data: content.data }));
                }
            }
        }
        return true;
    }

    async copy(srcPath: string, destPath: string): Promise<boolean> {
        const srcDesc = await this.stat(srcPath);
        if (!srcDesc) return false;

        if (srcDesc.isDirectory) {
            await this.createDirectory(destPath);
            const children = await this.listDirectory(srcPath);
            for (const child of children) {
                await this.copy(child.descriptor.path, destPath + '/' + child.descriptor.name);
            }
            return true;
        } else {
            const data = await this.readFile(srcPath);
            if (!data) return false;

            await this.createFile(destPath);
            return this.writeFile(destPath, data);
        }
    }

    async truncate(path: string, length: number): Promise<boolean> {
        const data = await this.readFile(path);
        if (!data) return false;

        if (length < data.length) {
            const newData = data.slice(0, length);
            return this.writeFile(path, newData);
        }
        return true;
    }
}
