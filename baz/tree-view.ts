/// <reference path="tree-view.d.ts" />
/// <reference path="jquery.d.ts" />

import async = module("./async");
import utils = module("./utils");

class FSTreeNode implements IFSTreeNode {
    id                  : string;
    nodes               : IFSTreeNode[];
    isOpen              : bool;

    private _db         : IFileDb;
    private _env        : IEnvironment;
    private _file       : IFile;
    private _$this      : JQuery;
    private _$parent    : JQuery;
    private _tree       : FSTreeView;

    private static _EFFECT_DURATION = 100;
    private static _NOOP            = function() { };
    private static _TYPE_ORDER : { [type : string] : number; } = 
        (function() {
            var order = {};
            order["application/vnd.baz.solution"]   = 1;
            order["application/vnd.baz.project"]    = 2;
            order["applicatoin/vnd.baz.directory"]  = 3;
            return order;
        })();

    constructor(
        file            : IFile,
        $parent         : JQuery,
        db              : IFileDb, 
        environment     : IEnvironment,
        tree            : FSTreeView
    ) {
        this._db        = db;
        this._env       = environment;
        this._file      = file;
        this._$parent   = $parent;
        this._tree      = tree;
        this.id         = utils.Guid.make();
        this.isOpen     = false;
    }

    private _getMimeClass() {
        return this._file.type.replace(/[\.\/]/g, '-');
    }

    render() {
        if (!this._$this) {
            this._$this = $('<div/>').appendTo(this._$parent).addClass('node');
        }

        var $item = $('<div/>')
            .appendTo(this._$this)
            .addClass(this._getMimeClass() + " item")
            .attr('id', this.id)
            .hover(
                () => this._tree.fireNodeMouseIn(this),
                () => this._tree.fireNodeMouseOut(this)
            );

        var $toggleWrapper  = $('<div/>').appendTo($item).addClass('toggle-content-view');

        if (this._file.childCount > 0) {
            $('<div/>').appendTo($toggleWrapper).addClass('btn').click( _ => this.toggle() );
        }

        var $icon = $('<div/>').appendTo($item).addClass('icon');
        var $name = $('<div/>').appendTo($item).addClass('name').text(this._file.name);

        var $actions = $('<div/>').appendTo($item).addClass('actions');
        var $refresh = $('<div/>').appendTo($actions).addClass('refresh').click( _ => this.refresh() );
        var $add     = $('<div/>').appendTo($actions).addClass('add');
        var $remove  = $('<div/>').appendTo($actions).addClass('remove');

        var $contents       = $('<div/>').appendTo(this._$this).addClass('content');

        if (this.nodes) {
            for (var i = 0, node : IFSTreeNode; node = this.nodes[i]; i++) {
                node.render();
            }
        }
    }

    toggle(cb? : ICallback) {
        if (this.isOpen)    this.close(cb);
        else                this.open(cb);
    }

    open(cb? : ICallback) {
        this._$this.addClass('open');
        this.isOpen = true;

        var $content = this._$this.children('.content').hide();
        this.refresh(() => {
            $content.slideDown(FSTreeNode._EFFECT_DURATION, () => {
                this._tree.fireTreeChange(this);
                cb && cb();
            })
        });
    }

    close(cb? : ICallback) {
        this._$this.removeClass('open');
        this.isOpen = false;

        var $content = this._$this.children('.content');
        $content.slideUp(FSTreeNode._EFFECT_DURATION, () => { 
            $content.empty();
            this.nodes = null;
            this._tree.fireTreeChange(this);
            cb && cb();
        });
    }

    refresh(cb? : ICallback) {
        if (!this.isOpen) {
            return;
        }

        this._$this.children('.content').empty()

        var i = 0, asyncOps = new Array(this._file.childCount);

        this._file.forEachChild((child : IChildInfo) => {
            asyncOps[i++] = (cb =>
                this._db.get(
                    this._db.utils.getAbsolutePath({
                        name    : child.name,
                        location: this._file.absolutePath
                    }),
                    cb
                )
            );
        });

        async
            .newTaskSeq(asyncOps)
            .done(
                function(...argArray : IArguments[]) => {
                    var response : IResponse;

                    var nodes : FSTreeNode[] = new Array(this._file.childCount);
                    
                    for (var i = 0, args : IArguments; args = argArray[i]; i++) {
                        response = args[0];

                        if (!response.success) {
                            this._env.log('FAILURE: Could not open child of "%s".', this._file.absolutePath);
                        }

                        nodes[i] = new FSTreeNode(
                            response.result, 
                            this._$this.children('.content'), 
                            this._db, 
                            this._env,
                            this._tree
                        );
                    }

                    this.nodes = nodes.sort(
                        (a : FSTreeNode, b : FSTreeNode) => this._compareFn(a, b)
                    );

                    for (var i = 0, node : IFSTreeNode; node = this.nodes[i]; i++) {
                        node.render();
                    }

                    cb && cb();
                }
            );
    }

    private _compareType(a : FSTreeNode, b : FSTreeNode) : number {
        var aType               = a._file.type
          , bType               = b._file.type
          , aPriority           = FSTreeNode._TYPE_ORDER[aType]
          , bPriority           = FSTreeNode._TYPE_ORDER[bType]
          , aPriorityUndefined  = typeof aPriority === 'undefined'
          , bPriorityUndefined  = typeof bPriority === 'undefined'

        if (aPriorityUndefined && bPriorityUndefined) {
            return 0;
        }

        if (aPriorityUndefined) {
            return 1;
        }

        if (bPriorityUndefined) {
            return -1;
        }
        
        if (aPriority === bPriority) {
            return 0
        };

        return aPriority > bPriority ? 1 : -1
    }

    private _compareName(a : FSTreeNode, b : FSTreeNode) : number {
        return a._file.name > b._file.name ? 1 : -1;
    }

    private _compareFn(a : FSTreeNode, b : FSTreeNode) : number {
        var type = this._compareType(a, b);
        if (type != 0) {
            return type;
        }

        return this._compareName(a, b);
    }
}

class FSTreeViewBGLayer implements IFSTreeViewBGLayer {
    private static _RX_ITEM_ID = /^bg-(.*)/;

    private _$parent    : JQuery;
    private _$this      : JQuery;
    private _items      : { [ id : string ] : JQuery; };
    private _itemOrder  : string[];
    private _selected   : JQuery;

    constructor($parent : JQuery) {
        this._$parent   = $parent;
        this._$this     = null;
    }

    render() {
        if (!this._$this) {
            this._$this = $('<div/>').addClass('bg-layer').prependTo(this._$parent);
        }

        this._$this.empty();

        if (!this._items) {
            return;
        }

        for (var i = 0, id : string; id = this._itemOrder[i]; i++) {
            this._items[id].appendTo(this._$this);
        }
    }

    ensureItems(itemIds : string[]) : void {
        this._itemOrder = itemIds;
        this._items = { };

        for (var i = 0, id; id = itemIds[i]; i++) {
            this._items[id] = $('<div/>')
                .attr('id', 'bg-' + id)
                .hover(
                    (ev) => { 
                        var match = FSTreeViewBGLayer._RX_ITEM_ID.exec((<any>ev.target).id);
                        if (match && match[1]) {
                            this.mouseOver(match[1]);
                        }
                    },
                    (ev) => {
                        var match = FSTreeViewBGLayer._RX_ITEM_ID.exec((<any>ev.target).id);
                        if (match && match[1]) {
                            this.mouseOut(match[1]);
                        }
                    }
                );
        }

        this.render();
    }

    mouseOver(itemId) {
        this._items[itemId].addClass('hover');
        $('#' + itemId).addClass('hover');
    }

    mouseOut(itemId) {
        this._items[itemId].removeClass('hover');
        $('#' + itemId).removeClass('hover');
    }

    select(itemId) {
        this._selected.removeClass('selected');
        this._selected = this._items[itemId].addClass('selected');
    }
}

export class FSTreeView implements IFSTreeView {
    private static _DEFAULT_ENV : IEnvironment  = { log: function(any, ...args : any[]) { } }

    private _db         : IFileDb;
    private _env        : IEnvironment;
    private _root       : IFSTreeNode;
    private _path       : string;
    private _bg         : IFSTreeViewBGLayer;
    private _parentSel  : string;
    private _$this      : JQuery;

    private _treeChangeHandlers     : IFSTreeViewEventHandler[];
    private _nodeSelectHandlers     : IFSTreeViewEventHandler[];
    private _nodeMouseInHandlers    : IFSTreeViewEventHandler[];
    private _nodeMouseOutHandlers   : IFSTreeViewEventHandler[];

    constructor(config : IFSTreeConfig) {
        this._db            = config.db;
        this._path          = config.path           || '/';
        this._env           = config.environment    || FSTreeView._DEFAULT_ENV;
        this._parentSel     = config.parentSel;

        this._treeChangeHandlers    = [];
        this._nodeMouseInHandlers   = [];
        this._nodeMouseOutHandlers  = [];
        this._nodeSelectHandlers    = [];

        this.onTreeChange((sender : IFSTreeNode) => {
            var itemIds : string[] = [];
            this.traverse((node : IFSTreeNode) => {
                itemIds.push(node.id);
                return true;
            });
            this._bg.ensureItems(itemIds);
        });

        this.onNodeSelect((sender : IFSTreeNode) => this._bg.select(sender.id));

        this.onNodeHover(
            (mouseInSender  : IFSTreeNode) => this._bg.mouseOver(mouseInSender.id), 
            (mouseOutSender : IFSTreeNode) => this._bg.mouseOut(mouseOutSender.id)
        );

        $(() => {
            this.render();
            this._bg = new FSTreeViewBGLayer(this._$this);
            this._openRoot();
        });
    }

    render() {
        if (!this._$this) {
            this._$this = $('<div/>').addClass('tree-view').appendTo(this._parentSel);
        }
    }

    private _openRoot() {
        async
            .newTask(cb => this._db.get(this._path, cb))
            .done((response : IResponse) => {
                if (!response.success) {
                    this._env.log(
                        "Failed to open FS root (tree-view.ts:FSTreeView:constructor)"
                    );
                }

                this._root = new FSTreeNode(
                    response.result, 
                    this._$this, 
                    this._db, 
                    this._env,
                    this
                );
                
                this._root.render();
                this._root.open();
            }
        );
    }

    traverse(fn : (node : IFSTreeNode) => bool) {
        this._traverse(this._root, fn);
    }

    private _traverse(startNode : IFSTreeNode, fn : (node :IFSTreeNode) => bool) {
        if (!fn(startNode) || !startNode.isOpen || !startNode.nodes) {
            return;
        }

        for (var i = 0, node; node = startNode.nodes[i]; i++) {
            this._traverse(node, fn);
        }
    }

    fireTreeChange(sender : IFSTreeNode) {
        for (var i = 0, handler; handler = this._treeChangeHandlers[i]; i++) {
            handler(sender);
        }
    }

    fireNodeSelect(sender : IFSTreeNode) {
        for (var i = 0, handler; handler = this._nodeSelectHandlers[i]; i++) {
            handler(sender);
        }
    }

    fireNodeMouseIn(sender : IFSTreeNode) {
        for (var i = 0, handler; handler = this._nodeMouseInHandlers[i]; i++) {
            handler(sender);
        }
    }

    fireNodeMouseOut(sender : IFSTreeNode) {
        for (var i = 0, handler; handler = this._nodeMouseOutHandlers[i]; i++) {
            handler(sender);
        }
    }

    onTreeChange(handler : IFSTreeViewEventHandler) {
        this._treeChangeHandlers.push(handler);
    }

    onNodeHover(mouseIn : IFSTreeViewEventHandler, mouseOut : IFSTreeViewEventHandler) {
        this._nodeMouseInHandlers.push(mouseIn);
        this._nodeMouseOutHandlers.push(mouseOut);
    }

    onNodeSelect(handler: IFSTreeViewEventHandler) {
        this._nodeSelectHandlers.push(handler);
    }
}