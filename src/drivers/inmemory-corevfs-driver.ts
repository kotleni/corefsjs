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
        console.log(`[${this.name}] Created file ${path}`);
        return { descriptor };
    }

    async removeFile(path: string): Promise<VFile | null> {
        const index = this.fs.journal.descriptors.findIndex(d => d.path === path);
        if (index === -1) return null;

        const desc = this.fs.journal.descriptors[index];
        if (desc.isDirectory) return null;

        this.fs.journal.descriptors.splice(index, 1);
        this.content.delete(path);
        console.log(`[${this.name}] Removed file ${path}`);
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
        console.log(`[${this.name}] Created directory ${path}`);
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
        const desc = this.findDescriptor(oldPath);
        if (!desc || this.findDescriptor(newPath)) return false;

        desc.path = newPath;
        desc.name = newPath.split('/').pop() || newPath;
        desc.modifiedAt = Date.now();

        if (!desc.isDirectory) {
            const data = this.content.get(oldPath);
            if (data) {
                this.content.set(newPath, data);
                this.content.delete(oldPath);
            }
        }
        return true;
    }

    async copy(srcPath: string, destPath: string): Promise<boolean> {
        const srcDesc = this.findDescriptor(srcPath);
        if (!srcDesc || srcDesc.isDirectory) return false;

        const data = this.content.get(srcPath);
        if (!data) return false;

        await this.createFile(destPath);
        return this.writeFile(destPath, new Uint8Array(data));
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
