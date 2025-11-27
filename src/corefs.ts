import {MountPoint} from "./mount-point";
import {CoreVFSDriver} from "./drivers/corevfs-driver";
import {VFile} from "./vfile";
import {FileStats} from "./filestats";

export class CoreVFS {
    private mounts: MountPoint[] = [];

    mount(driver: CoreVFSDriver, path: string): void {
        this.mounts.push({ path, driver });
        this.mounts.sort((a, b) => b.path.length - a.path.length);
    }

    private resolve(path: string): CoreVFSDriver {
        const mount = this.mounts.find(mp => {
            if (mp.path === '/') return true;
            if (path === mp.path) return true;
            if (path.startsWith(mp.path + '/')) return true;
            return false;
        });

        if (!mount) throw new Error(`No driver mounted for path: ${path}`);
        return mount.driver;
    }

    async createFile(path: string): Promise<VFile | null> {
        return this.resolve(path).createFile(path);
    }

    async removeFile(path: string): Promise<VFile | null> {
        return this.resolve(path).removeFile(path);
    }

    async createDirectory(path: string): Promise<boolean> {
        return this.resolve(path).createDirectory(path);
    }

    async removeDirectory(path: string): Promise<boolean> {
        return this.resolve(path).removeDirectory(path);
    }

    async listDirectory(path: string): Promise<VFile[]> {
        return this.resolve(path).listDirectory(path);
    }

    async readFile(path: string): Promise<Uint8Array | null> {
        return this.resolve(path).readFile(path);
    }

    async writeFile(path: string, data: Uint8Array): Promise<boolean> {
        return this.resolve(path).writeFile(path, data);
    }

    async appendFile(path: string, data: Uint8Array): Promise<boolean> {
        return this.resolve(path).appendFile(path, data);
    }

    async exists(path: string): Promise<boolean> {
        return this.resolve(path).exists(path);
    }

    async stat(path: string): Promise<FileStats | null> {
        return this.resolve(path).stat(path);
    }

    async rename(oldPath: string, newPath: string): Promise<boolean> {
        const driver = this.resolve(oldPath);
        if (driver !== this.resolve(newPath)) {
            throw new Error("Cross-device link not implemented");
        }
        return driver.rename(oldPath, newPath);
    }

    async copy(srcPath: string, destPath: string): Promise<boolean> {
        const driver = this.resolve(srcPath);
        if (driver !== this.resolve(destPath)) {
            const data = await driver.readFile(srcPath);
            if (!data) return false;
            const destDriver = this.resolve(destPath);
            await destDriver.createFile(destPath);
            return destDriver.writeFile(destPath, data);
        }
        return driver.copy(srcPath, destPath);
    }

    async truncate(path: string, length: number): Promise<boolean> {
        return this.resolve(path).truncate(path, length);
    }
}
