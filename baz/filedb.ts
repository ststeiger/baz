/// <reference path="filedb.d.ts" />

// import async = module('./async');
// import g = module('./guid');

import * as async from "./async";
import * as g from "./guid";



interface IDBObjectStore {
    delete(key: any): IDBRequest;
}


interface IResponse {
    success: boolean;
    error?: any;
    result?: any;
}

interface IEnvironment {
    log: (text: string, ...args: any[]) => void;
}


interface ITransactionConfig {
    mode?       : string;
    stores?     : string[];
    initMsg     : string;
    errorMsg    : string;
    abortMsg    : string;
    successMsg  : string;
    cb          : (response : IResponse) => any;
}

class FileNode implements IFileNode {
    public static _rxRepeatingSlash = /\/{2,}/g;
    public static _rxTrailingSlash = /(.+?)(?:\/*)$/;

    private _name       : string;
    private _location   : string;

    type        : string;
    children    : IChildNodeDictionary;
    childCount  : number;
    contentId   : IGuid;

    constructor(fileNodeData : IFileNodeData) {
        this.name       = fileNodeData.name;
        this.location   = fileNodeData.location;
        this.type       = fileNodeData.type;
        this.children   = fileNodeData.children || { };
        this.contentId  = fileNodeData.contentId ? new g.Guid(fileNodeData.contentId) : g.Guid.generate();

        this.childCount = Object.getOwnPropertyNames(this.children).length;
    }

    addChild(child : IChildNode) {
        this.children[child.name] = {
            name : child.name, 
            type : child.type
        };
    }

    removeChild(filename) {
        delete this.children[filename];
    }

    forEachChild(fn : (child : IChildNode) => any) : void {
        var names = Object.getOwnPropertyNames(this.children);

        for (var i = 0, child; child = this.children[names[i]]; i++) {
            fn(child);
        }
    }

    cloneFileNodeData(): IFileNodeData {
        return {
            name: this.name,
            location: this.location,
            type: this.type,
            children: this.children,
            absolutePath: this.absolutePath,
            contentId: this.contentId.value
        };
    }

    cloneChildNodeData() : IChildNode {
        return {
            name        : this.name,
            type        : this.type
        }
    }

    cloneChildren() : IChildNodeDictionary {
        var clone : IChildNodeDictionary = { };

        this.forEachChild((child : IChildNode) => {
            clone[child.name] = {
                name : child.name,
                type : child.type
            }
        });

        return clone;
    }

    get name() {
        return this._name;
    }

    set name(value : string) {
        value = FileUtils.trimTrailingSlashes((value || "").trim())

        // any remaining slashes should throw exception
        if (value && value.indexOf('/') >= 0) {
            throw ('FAILURE: Invalid file name: "' + value + '".');
        }

        this._name = value;
    }

    get location() {
        return this._location
    }

    set location(value) {
        value = FileUtils.normalizePath(value);

        if (value === "") {
            throw ('FAILURE: Invalid file location (empty). File: "' + this.name + '".');
        }

        this._location = value;
    }

    get size() {
        var files = Object.getOwnPropertyNames(this.children);
        this.forEachChild(c => {
            // TODO: recursively sum sizes
        });

        //if (this.content instanceof ArrayBuffer) {
        //    return (<ArrayBuffer> this.content).byteLength;
        //}

        //return (<string> this.content).length;
        return -1;
    }

    get absolutePath() {
        return FileUtils.getAbsolutePath(this);
    }
}

module FileUtils {
    var rxRepeatingSlash        = /\/{2,}/g;
    var rxTrailingSlash         = /(.+?)(?:\/*)$/;
    var rxFilenameAndLocation   = /^(\/(?:.*(?=\/))?)\/?(.*)$/

    export function normalizePath(value : string) {
        return trimTrailingSlashes(
            (value || "").trim().replace(FileNode._rxRepeatingSlash, '/')
        );
    }

    export function trimTrailingSlashes(value : string) {
        var result = FileNode._rxTrailingSlash.exec((value || "").trim());
        if (result && result[1]) {
            value = result[1];
        }
        return value;
    }

    export function getAbsolutePath(pathInfo : IPathInfo) {
        return normalizePath(pathInfo.location + '/' + pathInfo.name);
    }

    export function getPathInfo(absolutePath : string) {
        absolutePath = normalizePath(absolutePath);
        var results = rxFilenameAndLocation.exec(absolutePath);
        return {
            location    : results[1],
            name        : results[2]
        }
    }
}

class FileDb implements IFileDb {
    private static _OPEN_DBS                    : { [dbName : string] : IDBDatabase; } = { };
    private static _NOOP                        = () => {};
    private static _INDEXEDDB                   = window.indexedDB;
    private static _FILE_NODE_STORE             = "file-nodes";
    private static _FILE_CONTENT_STORE          = "file-contents";
    private static _FILE_STORE_KEY              = "absolutePath";
    private static _FILE_STORE_NAME_INDEX       = "name";
    private static _READ_WRITE                  = "readwrite";
    private static _READ_ONLY                   = "readonly";
    private static _VERSION_CHANGE              = "versionchange";
    private static _CURRENT_DB_VERSION          = 1;
    private static _DEFAULT_ENV : IEnvironment  = { log: function(any, ...args : any[]) { } }

    private _name       : string;
    private _version    : number;
    private _env        : IEnvironment;

    public get name()       { return this._name; }
    public get version()    { return this._version; }

    public utils : IFileUtils = FileUtils;

    constructor(config : IFileDbConfig)
    {
        this._name      = config.name;
        this._version   = config.version        || FileDb._CURRENT_DB_VERSION;
        this._env       = config.environment    || FileDb._DEFAULT_ENV;
    }

    private _openDb() {
        return (cb : (db : IDBDatabase) => any) => {
            if (FileDb._OPEN_DBS.hasOwnProperty(this.name)) {
                cb(FileDb._OPEN_DBS[this.name]);
                return;
            }

            this._env.log('INFO: Opening database "%s", version "%d"...', this.name, this.version);
            var request = FileDb._INDEXEDDB.open(this.name, this.version);

            request.onsuccess = (ev) => {
                var result : IDBDatabase = request.result;

                this._env.log('\tSUCCESS: Opened database "%s", version "%d".', result.name, result.version);
                FileDb._OPEN_DBS[this.name] = result;
                cb(result);
            }

            request.onerror = (ev) => {
                this._env.log("\tFAILURE:", (<any> ev.target).error);
            }

            request.onupgradeneeded = (ev) => {
                var db = <IDBDatabase> request.result;
                this._env.log(
                    'INFO: Upgrade needed for database "%s", version "%d". Current Version: "%d".',
                    db.name,
                    db.version,
                    FileDb._CURRENT_DB_VERSION
                );

                switch(db.version) {
                    default: 
                        this._initDb(db);
                        break;
                }
            }
        };
    }

    private _initDb(db : IDBDatabase) {
        this._env.log(
            'INFO: Creating object store "%s" in database "%s"...', 
            FileDb._FILE_CONTENT_STORE, 
            db.name
        );
        var fileContentStore = db.createObjectStore(FileDb._FILE_CONTENT_STORE);

        this._env.log(
            'INFO: Creating object store "%s" in database "%s"...', 
            FileDb._FILE_NODE_STORE, 
            db.name
        );
        var fileNodeStore = db.createObjectStore(FileDb._FILE_NODE_STORE);

        fileNodeStore.createIndex(
            FileDb._FILE_STORE_NAME_INDEX, 
            FileDb._FILE_STORE_NAME_INDEX, 
            { unique: false }
        );

        var rootNode = new FileNode({
            name        : '',
            location    : '/',
            type        : 'application/vnd.baz.root',
            children    : null,
            contentId   : null
        });

        fileNodeStore
            .put(rootNode.cloneFileNodeData(), rootNode.absolutePath)
            .onerror = (ev) => {
                this._env.log('\tFAILURE: Could not create ROOT in database "%s".', this.name)
            };
    }

    private _getTransaction(db : IDBDatabase, config : ITransactionConfig) {
        return (cb : (transaction : IDBTransaction) => any) => {
            var stores = config.stores;

            if (!stores || config.stores.length < 1) {
                stores = [FileDb._FILE_NODE_STORE];
            }

            var transaction = db.transaction(stores, config.mode || FileDb._READ_ONLY);

            this._env.log(config.initMsg);

            transaction.onerror = (ev) => {
                this._env.log(config.errorMsg);
                config.cb({ success: false, error: (<any> ev.target).error });
            }

            transaction.onabort = (ev) => {
                this._env.log(config.abortMsg);
                config.cb({ success: false, error: (<any> ev.target).error });
            }

            transaction.oncomplete = (ev) => {
                this._env.log(config.successMsg);
                config.cb({ success: true, result: (<any> ev.target).result });
            }

            cb(transaction);
        }
    }

    private _addChildReferenceFor(file : FileNode, transaction : IDBTransaction) {
        async.newTask(cb => transaction
            .objectStore(FileDb._FILE_NODE_STORE)
            .get(file.location)
            .onsuccess = (ev) => {
                var result = (<any> ev.target).result;

                if (typeof result === 'undefined') {
                    (<any> ev.target).transaction.abort();
                }

                else cb(result);
            }
        ).next((parentNodeData : IFileNodeData) => {
            var parentNode = new FileNode(parentNodeData);
            parentNode.addChild(file.cloneChildNodeData());

            return cb => transaction
                .objectStore(FileDb._FILE_NODE_STORE)
                .put(parentNode.cloneFileNodeData(), parentNode.absolutePath)
                .onsuccess = cb;
        }).done(() =>
            this._env.log(
                '\tSUCCESS: Added reference "%s" to parent "%s".',
                file.name,
                file.location
            )
        );
    }

    private _removeChildReferenceFor(absolutePath : string, transaction : IDBTransaction) {
        var pathInfo = FileUtils.getPathInfo(absolutePath);

        async.newTask(cb => transaction
            .objectStore(FileDb._FILE_NODE_STORE)
            .get(pathInfo.location)
            .onsuccess = (ev) => {
                var result = (<any> ev.target).result;

                if (typeof(result) === 'undefined') {
                    (<any> ev.target).transaction.abort();
                } 
                else cb(result);
            }
        ).next((parentNodeData : IFileNodeData) => {
            var parentNode = new FileNode(parentNodeData);

            parentNode.removeChild(pathInfo.name);

            return cb => transaction
                .objectStore(FileDb._FILE_NODE_STORE)
                .put(parentNode.cloneFileNodeData(), parentNode.absolutePath)
                .onsuccess = cb;
            }
        ).done(() =>
            this._env.log(
                '\tSUCCESS: Removed reference "%s" from parent "%s".',
                pathInfo.name,
                pathInfo.location
            )
        );
    }

    private _traverseWithAction(
        transaction : IDBTransaction,
        root        : FileNode, 
        action      : (file : FileNode) => void
    ) {
        root.forEachChild(c => transaction
            .objectStore(FileDb._FILE_NODE_STORE)
            .get(
                FileUtils.getAbsolutePath({ 
                    name    : c.name, 
                    location: root.absolutePath
                })
            )
            .onsuccess = (ev => {
                var result : IFileNodeData = (<any> ev.target).result;

                if (result) {
                    this._traverseWithAction(transaction, new FileNode(result), action);
                }
            })
        );

        action(root);
    }

    private _cpFileNodeBranch(
        source          : string, 
        destination     : string, 
        transaction     : IDBTransaction,
        detachContent   = false
    ) {
        return (cb : (sourceNode : FileNode, destinationNode : FileNode, transaction : IDBTransaction) => any) => transaction
            .objectStore(FileDb._FILE_NODE_STORE)
            .get(source)
            .onsuccess = (ev) => {
                var fileNodeData = (<any> ev.target).result;

                if (typeof(fileNodeData) === 'undefined') {
                    (<any> ev.target).transaction.abort();
                    return;
                }

                var root = new FileNode(fileNodeData);

                this._traverseWithAction(transaction, root, (fileNode : FileNode) => {
                    var newNode     : FileNode     = null,
                        newNodeData : IFileNodeData = null,
                        isRoot      = fileNode.absolutePath === root.absolutePath,
                        newPathInfo = isRoot 
                                    ? FileUtils.getPathInfo(destination)
                                    : FileUtils.getPathInfo(fileNode.absolutePath.replace(source, destination));

                    newNodeData = {
                        name        : newPathInfo.name,
                        location    : newPathInfo.location,
                        type        : fileNode.type,
                        contentId   : detachContent ? null : fileNode.contentId.value,
                        children    : fileNode.cloneChildren()
                    }

                    var newNode = new FileNode(newNodeData);

                    if (isRoot) {
                        this._addChildReferenceFor(newNode, transaction);
                    }

                    transaction
                        .objectStore(FileDb._FILE_NODE_STORE)
                        .add(newNode.cloneFileNodeData(), newNode.absolutePath) // use add to prevent overwriting a node
                        .onsuccess = ev => cb(fileNode, newNode, transaction)
            });
        }
    }

    private _resolveContentId(transaction : IDBTransaction, identifier : any) {
        var fail = () => {
            this._env.log(
                '\tFAILURE: Cannot resolve file content with identifier "%s" (contentId: "%s").',
                identifier
            );
            transaction.abort();
        }

        if (typeof identifier === 'string') {
            identifier = FileUtils.normalizePath(identifier);

            return (cb : (contentId : string, transaction : IDBTransaction) => any) => transaction
                .objectStore(FileDb._FILE_NODE_STORE)
                .get(identifier)
                .onsuccess = ev => {
                    var fileNodeData : IFileNodeData = (<any> ev.target).result;
                    if (!fileNodeData.contentId) {
                        fail();
                    }
                    cb(fileNodeData.contentId, transaction);
                }
        }
        else if (identifier instanceof g.Guid) {
            return (cb : (contentId : string, transaction : IDBTransaction) => any) => {
                var contentId = (<g.Guid> identifier).value;
                if (!contentId) {
                    fail();
                }
                cb(contentId, transaction);
            }
        }
        else fail();
    }

    getFileNode(absolutePath : string, cb : (response : IResponse) => any) {
        if (!cb) return;

        absolutePath = FileUtils.normalizePath(absolutePath);

        this._env.log('INFO: Getting "%s" from database "%s"...', absolutePath, this.name);

        async
            .newTask(this._openDb())
            .done((db : IDBDatabase) => {
                var request = db.transaction(FileDb._FILE_NODE_STORE, FileDb._READ_ONLY)
                                .objectStore(FileDb._FILE_NODE_STORE)
                                .get(absolutePath);

                request.onsuccess = (ev) => {
                    if (typeof(request.result) === 'undefined') {
                        this._env.log('\tERROR: No file found at path "%s" in database "%s".', absolutePath, this.name);
                        cb({ success: false, error: ['No file found at path "', absolutePath, '" in database "', this.name, '".'].join('') });
                    }
                    else {
                        this._env.log('\tSUCCESS: Got "%s" from database "%s".', absolutePath, this.name);
                        cb({ success: true, result: new FileNode(request.result) });
                    }
                }

                request.onerror = (ev) => {
                    this._env.log('\tFAILURE: Could not get "%s" from database "%s".', absolutePath, this.name);
                    cb({ success: false, error: request.error });
                }
            });
    }

    getFileContent(contentId : g.Guid, cb : (response : IResponse) => any) : void;
    getFileContent(absolutePath : string, cb : (response : IResponse) => any) : void;
    getFileContent(identifier : any, cb : (response : IResponse) => any) : void {
        if (!cb) return;

        var transactionConfig : ITransactionConfig = {
            mode        : FileDb._READ_ONLY,
            stores      : [ FileDb._FILE_NODE_STORE, FileDb._FILE_CONTENT_STORE ],
            initMsg     : ['INFO: Starting transaction to get file contents of "', identifier, '" from database "', this.name, '"...'].join(''),
            successMsg  : ['\tSUCCESS: Transaction for getting file contents of "', identifier, '" from database "', this.name, '" completed.'].join(''),
            abortMsg    : ['\tFAILURE: Transaction aborted while getting file contents of "', identifier, '" from database "', this.name, '".'].join(''),
            errorMsg    : ['\tFAILURE: Could not get "', identifier, '" from database "', this.name, '".'].join(''),
            cb          : cb
        };

        async
            .newTask(this._openDb())
            .next((db : IDBDatabase) => this._getTransaction(db, transactionConfig))
            .next((transaction : IDBTransaction) => this._resolveContentId(transaction, identifier))
            .done((contentId : string, transaction : IDBTransaction) =>
                // Let the default 'oncomplete' transaction handler forward the response to our callback
                // (i.e., no need to any completion/success handling here)
                transaction.objectStore(FileDb._FILE_CONTENT_STORE).get(contentId)
            );
    }

    putFileContent(contentId : IGuid, data : any, cb? : (response : IResponse) => any) : void;
    putFileContent(absolutePath : string, data : any, cb? : (response : IResponse) => any) : void;
    putFileContent(identifier : any, data : any, cb? : (response : IResponse) => any) : void {
        if (!cb) cb = FileDb._NOOP;

        var transactionConfig : ITransactionConfig = {
            mode        : FileDb._READ_WRITE,
            stores      : [ FileDb._FILE_NODE_STORE, FileDb._FILE_CONTENT_STORE ],
            initMsg     : ['INFO: Starting transaction to save file contents of "', identifier, '" to database "', this.name, '"...'].join(''),
            successMsg  : ['\tSUCCESS: Transaction for saving file contents of "', identifier, '" to database "', this.name, '" completed.'].join(''),
            abortMsg    : ['\tFAILURE: Transaction aborted while saving file contents of "', identifier, '" to database "', this.name, '".'].join(''),
            errorMsg    : ['\tFAILURE: Could not save "', identifier, '" to database "', this.name, '".'].join(''),
            cb          : cb
        };

        async
            .newTask(this._openDb())
            .next((db : IDBDatabase) => this._getTransaction(db, transactionConfig))
            .next((transaction : IDBTransaction) => this._resolveContentId(transaction, identifier))
            .done((contentId : string, transaction : IDBTransaction) =>
                // Let the default 'oncomplete' transaction handler forward the response to our callback
                // (i.e., no need to any completion/success handling here)
                transaction.objectStore(FileDb._FILE_CONTENT_STORE).put(data, contentId)
            );
    }

    putFileNode(fileNodeData : IFileNodeData, cb? : (response : IResponse) => any) {
        if (!cb) cb = FileDb._NOOP;

        var fileNode = new FileNode(fileNodeData);

        var transactionConfig : ITransactionConfig = {
            mode        : FileDb._READ_WRITE,
            initMsg     : ['INFO: Starting transaction to save "', fileNode.absolutePath, '" to database "', this.name, '"...'].join(''),
            successMsg  : ['\tSUCCESS: Transaction for saving "', fileNode.absolutePath, '" to database "', this.name, '" completed.'].join(''),
            abortMsg    : ['\tFAILURE: Transaction aborted while saving "', fileNode.absolutePath, '" to database "', this.name, '".'].join(''),
            errorMsg    : ['\tFAILURE: Could not save "', fileNode.absolutePath, '" to database "', this.name, '".'].join(''),
            cb          : cb
        };

        async
            .newTask(this._openDb())
            .next((db : IDBDatabase) => this._getTransaction(db, transactionConfig))
            .next((transaction : IDBTransaction) => {
                this._addChildReferenceFor(fileNode, transaction);

                return cb =>
                    transaction
                        .objectStore(FileDb._FILE_NODE_STORE)
                        .put(fileNode.cloneFileNodeData(), fileNode.absolutePath)
                        .onsuccess = cb
            })
            .done(() => 
                this._env.log('\tSUCCESS: Saved "%s" to database "%s".', fileNode.absolutePath, this.name)
            );
    }



    rm(absolutePath : string, cb? : (response : IResponse) => any) {
        if (!cb) cb = FileDb._NOOP;

        absolutePath = FileUtils.normalizePath(absolutePath);

        var transactionConfig : ITransactionConfig = {
            mode        : FileDb._READ_WRITE,
            stores      : [ FileDb._FILE_NODE_STORE, FileDb._FILE_CONTENT_STORE ],  
            initMsg     : ['INFO: Starting transaction to remove "', absolutePath, '" from database "', this.name, '"...'].join(''),
            successMsg  : ['\tSUCCESS: Transaction for removal of "', absolutePath, '" from database "', this.name, '" completed.'].join(''),
            errorMsg    : ['\tFAILURE: Could not remove "', absolutePath, '" from database "', this.name, '".'].join(''),
            abortMsg    : ['\tFAILURE: Transaction aborted while deleting "', absolutePath, '" from database "', this.name, '".'].join(''),
            cb          : cb
        };

        async
            .newTask(this._openDb())
            .next((db : IDBDatabase) => this._getTransaction(db, transactionConfig))
            .next((transaction : IDBTransaction) => {
                this._removeChildReferenceFor(absolutePath, transaction);

                return cb => transaction
                    .objectStore(FileDb._FILE_NODE_STORE)
                    .get(absolutePath)
                    .onsuccess = (ev) => {
                        var result = (<any> ev.target).result;

                        if (typeof(result) === 'undefined') {
                            (<any> ev.target).transaction.abort();
                        }
                        else cb(new FileNode(result), transaction);
                    }
            })
            .next((root : FileNode, transaction : IDBTransaction) =>
                cb => this._traverseWithAction(
                    transaction,
                    root,
                    (fileNode : FileNode) => transaction
                        .objectStore(FileDb._FILE_NODE_STORE)
                        .delete(fileNode.absolutePath)
                        .onsuccess = ev => cb(fileNode, transaction)
                )
            )
            .next((fileNode : FileNode, transaction : IDBTransaction) =>
                cb => transaction
                    .objectStore(FileDb._FILE_CONTENT_STORE)
                    .delete(fileNode.contentId.value)
                    .onsuccess = ev => cb(fileNode)
            )
            .done((fileNode : FileNode) =>
                this._env.log(
                    '\tSUCCESS: Removing item "%s" from database "%s".',
                    fileNode.absolutePath,
                    this.name
                )
            );
    }

    cp(source : string, destination : string, cb? : (response : IResponse) => any) {
        if (!cb) cb = FileDb._NOOP;

        source      = FileUtils.normalizePath(source);
        destination = FileUtils.normalizePath(destination);

        var transactionConfig : ITransactionConfig = {
            mode        : FileDb._READ_WRITE,
            stores      : [ FileDb._FILE_NODE_STORE, FileDb._FILE_CONTENT_STORE ],
            initMsg     : ['INFO: Starting transaction to copy "', source, '" to "', destination, '" in database "', this.name, '"...'].join(''),
            successMsg  : ['\tSUCCESS: Transaction for copying "', source, '" to "', destination, '" in database "', this.name, '" completed.'].join(''),
            errorMsg    : ['\tFAILURE: Could not copy "', source, '" to "', destination, '" in database "', this.name, '".'].join(''),
            abortMsg    : ['\tFAILURE: Transaction aborted while copying "', source, '" to "', destination, '" in database "', this.name, '".'].join(''),
            cb          : cb
        };

        async
            .newTask(this._openDb())
            .next((db : IDBDatabase) => this._getTransaction(db, transactionConfig))
            .next((transaction : IDBTransaction) => this._cpFileNodeBranch(source, destination, transaction, true))
            .next((sourceNode : FileNode, destinationNode : FileNode, transaction : IDBTransaction) =>
                cb => transaction
                    .objectStore(FileDb._FILE_CONTENT_STORE)
                    .get(sourceNode.contentId.value)
                    .onsuccess = ev => cb(sourceNode, destinationNode, (<any> ev.target).result, transaction)
            )
            .next((sourceNode : FileNode, destinationNode : FileNode, content : any, transaction : IDBTransaction) =>
                cb => transaction
                    .objectStore(FileDb._FILE_CONTENT_STORE)
                    .add(content, destinationNode.contentId.value)
                    .onsuccess = ev => cb(sourceNode, destinationNode)
            )
            .done((sourceNode : FileNode, destinationNode : FileNode) =>
                this._env.log('\tSUCCESS: Copied "%s" to "%s".', sourceNode.absolutePath, destinationNode.absolutePath)
            );
    }

    mv(source : string, destination : string, cb? : (response : IResponse) => any) {
        if (!cb) cb = FileDb._NOOP;

        source      = FileUtils.normalizePath(source);
        destination = FileUtils.normalizePath(destination);

        var transactionConfig : ITransactionConfig = {
            mode        : FileDb._READ_WRITE,
            initMsg     : ['INFO: Starting transaction to move "', source, '" to "', destination, '" in database "', this.name, '"...'].join(''),
            successMsg  : ['\tSUCCESS: Transaction for moving "', source, '" to "', destination, '" in database "', this.name, '" completed.'].join(''),
            errorMsg    : ['\tFAILURE: Could not move "', source, '" to "', destination, '" in database "', this.name, '".'].join(''),
            abortMsg    : ['\tFAILURE: Transaction aborted while moving "', source, '" to "', destination, '" in database "', this.name, '".'].join(''),
            cb          : cb
        };

        async
            .newTask(this._openDb())
            .next((db : IDBDatabase) => this._getTransaction(db, transactionConfig))
            .next((transaction : IDBTransaction) => {
                this._removeChildReferenceFor(source, transaction);
                return this._cpFileNodeBranch(source, destination, transaction)
            })
            .next((sourceNode : FileNode, destinationNode : FileNode, transaction : IDBTransaction) => cb =>
                transaction
                    .objectStore(FileDb._FILE_NODE_STORE)
                    .delete(sourceNode.absolutePath)
                    .onsuccess = ev => cb(sourceNode, destinationNode)
            )
            .done((sourceNode : FileNode, destinationNode : FileNode) =>
                this._env.log('\tSUCCESS: Moved "%s" to "%s".', sourceNode.absolutePath, destinationNode.absolutePath)
            );
    }
}

export function open(config : IFileDbConfig) : IFileDb {
    return new FileDb(config);
}