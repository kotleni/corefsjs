import {CoreVFSDriver} from "./drivers/corevfs-driver";

export interface MountPoint {
    path: string;
    driver: CoreVFSDriver;
}
