import { CoreVFSDriver } from "./drivers/corevfs-driver";
import { VFile } from "./vfile";
import { FileStats } from "./filestats";
import {MountPoint} from "./mount-point";
import {ResolvedPath} from "./resolved-path";

export class CoreVFS {
    private mounts: MountPoint[] = [];

    async mount(driver: CoreVFSDriver, path: string): Promise<void> {
        let cleanPath = path.startsWith('/') ? path : '/' + path;
        if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
            cleanPath = cleanPath.slice(0, -1);
        }

        try {
            await driver.createDirectory('/');
        } catch (e) {}

        if (cleanPath !== '/') {
            const exists = await this.exists(cleanPath);
            if (!exists) {
                try {
                    await this.createDirectory(cleanPath);
                } catch (e) {}
            }
        }

        this.mounts.push({ path: cleanPath, driver });
        this.mounts.sort((a, b) => b.path.length - a.path.length);
    }

    private resolve(path: string): ResolvedPath {
        const mount = this.mounts.find(mp => {
            if (mp.path === path) return true;
            if (mp.path === '/') return true;
            return path.startsWith(mp.path + '/');
        });

        if (!mount) {
            throw new Error(`No driver mounted for path: ${path}`);
        }

        let relativePath = path.slice(mount.path.length);
        if (relativePath === '') {
            relativePath = '/';
        }

        if(relativePath.length > 0 && !relativePath.startsWith('/'))
            relativePath = '/' + relativePath;

        return {
            driver: mount.driver,
            relativePath,
            mountPath: mount.path
        };
    }

    private fixDescriptorPath(vFile: VFile, mountPath: string): VFile {
        if (mountPath === '/') return vFile;

        const originalPath = vFile.descriptor.path;
        const suffix = originalPath === '/' ? '' : originalPath;

        vFile.descriptor.path = mountPath + suffix;
        return vFile;
    }

    async createFile(path: string): Promise<VFile | null> {
        const { driver, relativePath, mountPath } = this.resolve(path);
        const file = await driver.createFile(relativePath);
        return file ? this.fixDescriptorPath(file, mountPath) : null;
    }

    async removeFile(path: string): Promise<VFile | null> {
        const { driver, relativePath, mountPath } = this.resolve(path);
        const file = await driver.removeFile(relativePath);
        return file ? this.fixDescriptorPath(file, mountPath) : null;
    }

    async createDirectory(path: string): Promise<boolean> {
        const { driver, relativePath } = this.resolve(path);
        return driver.createDirectory(relativePath);
    }

    async removeDirectory(path: string): Promise<boolean> {
        const { driver, relativePath } = this.resolve(path);
        return driver.removeDirectory(relativePath);
    }

    async listDirectory(path: string): Promise<VFile[]> {
        const { driver, relativePath, mountPath } = this.resolve(path);
        const files = await driver.listDirectory(relativePath);
        return files.map(f => this.fixDescriptorPath(f, mountPath))
            .filter(f => f.descriptor.name !== '/');
    }

    async readFile(path: string): Promise<Uint8Array | null> {
        const { driver, relativePath } = this.resolve(path);
        return driver.readFile(relativePath);
    }

    async writeFile(path: string, data: Uint8Array): Promise<boolean> {
        const { driver, relativePath } = this.resolve(path);
        return driver.writeFile(relativePath, data);
    }

    async appendFile(path: string, data: Uint8Array): Promise<boolean> {
        const { driver, relativePath } = this.resolve(path);
        return driver.appendFile(relativePath, data);
    }

    async exists(path: string): Promise<boolean> {
        try {
            const { driver, relativePath } = this.resolve(path);
            return driver.exists(relativePath);
        } catch (e) {
            return false;
        }
    }

    async stat(path: string): Promise<FileStats | null> {
        const { driver, relativePath } = this.resolve(path);
        return driver.stat(relativePath);
    }

    async rename(oldPath: string, newPath: string): Promise<boolean> {
        const src = this.resolve(oldPath);
        const dst = this.resolve(newPath);

        if (src.driver !== dst.driver) {
            throw new Error(`EXDEV: cross-device link not permitted`);
        }

        return src.driver.rename(src.relativePath, dst.relativePath);
    }

    async copy(srcPath: string, destPath: string): Promise<boolean> {
        const src = this.resolve(srcPath);
        const dst = this.resolve(destPath);

        if (src.driver === dst.driver) {
            return src.driver.copy(src.relativePath, dst.relativePath);
        }

        const stats = await src.driver.stat(src.relativePath);
        if (!stats) return false;

        if (stats.isDirectory) {
            await this.createDirectory(destPath);
            const children = await this.listDirectory(srcPath);

            for (const child of children) {
                const childName = child.descriptor.name;
                await this.copy(
                    `${srcPath}/${childName}`.replace('//', '/'),
                    `${destPath}/${childName}`.replace('//', '/')
                );
            }
            return true;
        } else {
            const data = await src.driver.readFile(src.relativePath);
            if (data === null) return false;

            await this.createFile(destPath);
            return dst.driver.writeFile(dst.relativePath, data);
        }
    }

    async truncate(path: string, length: number): Promise<boolean> {
        const { driver, relativePath } = this.resolve(path);
        return driver.truncate(relativePath, length);
    }
}
