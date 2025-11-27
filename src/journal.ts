import {FileDescriptor} from "./file-descriptor";

export interface Journal {
    descriptors: FileDescriptor[];
}
