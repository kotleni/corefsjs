import {CoreVFSDriver} from "./drivers/corevfs-driver";

export interface ResolvedPath {
    driver: CoreVFSDriver;
    relativePath: string;
    mountPath: string;
}
