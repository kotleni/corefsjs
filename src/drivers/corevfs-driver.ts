import {VFile} from "../vfile";
import {FileStats} from "../filestats";

export interface CoreVFSDriver {
    createFile(path: string): Promise<VFile | null>;
    removeFile(path: string): Promise<VFile | null>;
    createDirectory(path: string): Promise<boolean>;
    removeDirectory(path: string): Promise<boolean>;
    listDirectory(path: string): Promise<VFile[]>;

    readFile(path: string): Promise<Uint8Array | null>;
    writeFile(path: string, data: Uint8Array): Promise<boolean>;
    appendFile(path: string, data: Uint8Array): Promise<boolean>;

    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FileStats | null>;

    rename(oldPath: string, newPath: string): Promise<boolean>;
    copy(srcPath: string, destPath: string): Promise<boolean>;
    truncate(path: string, length: number): Promise<boolean>;
}
