export interface FileDescriptor {
    path: string;
    parent: number;
    name: string;
    size: number;
    isDirectory: boolean;
    createdAt: number;
    modifiedAt: number;
}
