import {CoreVFSDriver} from "./corevfs-driver";
import {VFileSystem} from "../vfilesystem";
import {FileDescriptor} from "../file-descriptor";
import {VFile} from "../vfile";
import {FileStats} from "../filestats";

export class InMemoryVFSDriver implements CoreVFSDriver {
    fs: VFileSystem;
    name: string;
    private content: Map<string, Uint8Array>;

    constructor(name: string = 'memory') {
        this.name = name;
        this.fs = {
            journal: { descriptors: [] }
        };
        this.content = new Map();
    }

    private findDescriptor(path: string): FileDescriptor | undefined {
        return this.fs.journal.descriptors.find(d => d.path === path);
    }

    async createFile(path: string): Promise<VFile | null> {
        if (this.findDescriptor(path)) return null;

        const descriptor: FileDescriptor = {
            path: path,
            parent: -1,
            name: path.split('/').pop() || path,
            size: 0,
            isDirectory: false,
            createdAt: Date.now(),
            modifiedAt: Date.now()
        };

        this.fs.journal.descriptors.push(descriptor);
        this.content.set(path, new Uint8Array(0));
        return { descriptor };
    }

    async removeFile(path: string): Promise<VFile | null> {
        const index = this.fs.journal.descriptors.findIndex(d => d.path === path);
        if (index === -1) return null;

        const desc = this.fs.journal.descriptors[index];
        if (desc.isDirectory) return null;

        this.fs.journal.descriptors.splice(index, 1);
        this.content.delete(path);
        return { descriptor: desc };
    }

    async createDirectory(path: string): Promise<boolean> {
        if (this.findDescriptor(path)) return false;

        const descriptor: FileDescriptor = {
            path: path,
            parent: -1,
            name: path.split('/').pop() || path,
            size: 0,
            isDirectory: true,
            createdAt: Date.now(),
            modifiedAt: Date.now()
        };

        this.fs.journal.descriptors.push(descriptor);
        return true;
    }

    async removeDirectory(path: string): Promise<boolean> {
        const index = this.fs.journal.descriptors.findIndex(d => d.path === path);
        if (index === -1) return false;

        const desc = this.fs.journal.descriptors[index];
        if (!desc.isDirectory) return false;

        const hasChildren = this.fs.journal.descriptors.some(d =>
            d.path !== path && d.path.startsWith(path + '/')
        );
        if (hasChildren) return false;

        this.fs.journal.descriptors.splice(index, 1);
        return true;
    }

    async listDirectory(path: string): Promise<VFile[]> {
        const cleanPath = path === '/' ? '' : path;
        return this.fs.journal.descriptors
            .filter(d => {
                const parentPath = d.path.substring(0, d.path.lastIndexOf('/'));
                return parentPath === cleanPath && d.path !== cleanPath;
            })
            .map(descriptor => ({ descriptor }));
    }

    async readFile(path: string): Promise<Uint8Array | null> {
        const desc = this.findDescriptor(path);
        if (!desc || desc.isDirectory) return null;
        return this.content.get(path) || null;
    }

    async writeFile(path: string, data: Uint8Array): Promise<boolean> {
        const desc = this.findDescriptor(path);
        if (!desc || desc.isDirectory) return false;

        this.content.set(path, data);
        desc.size = data.length;
        desc.modifiedAt = Date.now();
        return true;
    }

    async appendFile(path: string, data: Uint8Array): Promise<boolean> {
        const desc = this.findDescriptor(path);
        const currentData = this.content.get(path);
        if (!desc || desc.isDirectory || !currentData) return false;

        const newData = new Uint8Array(currentData.length + data.length);
        newData.set(currentData);
        newData.set(data, currentData.length);

        this.content.set(path, newData);
        desc.size = newData.length;
        desc.modifiedAt = Date.now();
        return true;
    }

    async exists(path: string): Promise<boolean> {
        return !!this.findDescriptor(path);
    }

    async stat(path: string): Promise<FileStats | null> {
        const desc = this.findDescriptor(path);
        if (!desc) return null;
        return {
            size: desc.size,
            isDirectory: desc.isDirectory,
            createdAt: desc.createdAt,
            modifiedAt: desc.modifiedAt
        };
    }

    async rename(oldPath: string, newPath: string): Promise<boolean> {
        console.log(oldPath, newPath)
        const rootDesc = this.findDescriptor(oldPath);
        if (!rootDesc || this.findDescriptor(newPath)) return false;

        const itemsToMove = this.fs.journal.descriptors.filter(d =>
            d.path === oldPath || d.path.startsWith(oldPath + '/')
        );

        for (const desc of itemsToMove) {
            const suffix = desc.path.substring(oldPath.length);
            const destPath = newPath + suffix;

            const oldItemPath = desc.path;

            desc.path = destPath;
            desc.name = destPath.split('/').pop() || destPath;
            desc.modifiedAt = Date.now();

            if (!desc.isDirectory && this.content.has(oldItemPath)) {
                const data = this.content.get(oldItemPath)!;
                this.content.set(destPath, data);
                this.content.delete(oldItemPath);
            }
        }

        return true;
    }

    async copy(srcPath: string, destPath: string): Promise<boolean> {
        const srcDesc = this.findDescriptor(srcPath);
        if (!srcDesc) return false;

        if (srcDesc.isDirectory) {
            await this.createDirectory(destPath);
            const children = this.fs.journal.descriptors.filter(d => {
                const parentPath = d.path.substring(0, d.path.lastIndexOf('/'));
                return parentPath === srcPath;
            });

            for (const child of children) {
                await this.copy(child.path, destPath + '/' + child.name);
            }
            return true;
        } else {
            const data = this.content.get(srcPath);
            if (!data) return false;

            await this.createFile(destPath);
            // Copy buffer
            return this.writeFile(destPath, new Uint8Array(data));
        }
    }

    async truncate(path: string, length: number): Promise<boolean> {
        const desc = this.findDescriptor(path);
        const data = this.content.get(path);
        if (!desc || desc.isDirectory || !data) return false;

        if (length < data.length) {
            const newData = data.slice(0, length);
            this.content.set(path, newData);
            desc.size = length;
            desc.modifiedAt = Date.now();
        }
        return true;
    }
}
