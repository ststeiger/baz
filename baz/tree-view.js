/// <reference path="tree-view.d.ts" />
/// <reference path="jquery.d.ts" />
define(["require", "exports", "./async", "./guid"], function (require, exports, async, g) {
    var FSTreeNode = (function () {
        function FSTreeNode(file, $parent, db, environment, tree, indentLevel) {
            this._db = db;
            this._env = environment;
            this._file = file;
            this._$parent = $parent;
            this._tree = tree;
            this._indent = indentLevel || 0;
            this.id = g.Guid.generate().value;
            this.isOpen = false;
        }
        FSTreeNode.prototype._getMimeClass = function () {
            return this._file.type.replace(/[\.\/]/g, '-');
        };
        FSTreeNode.prototype.render = function () {
            var _this = this;
            if (!this._$this) {
                this._$this = $('<div/>').appendTo(this._$parent).addClass('node').attr('id', this.id);
            }
            var $itemContainer = $('<div/>')
                .addClass('item-container')
                .appendTo(this._$this)
                .css('padding-left', (this._tree.indentAmount * this._indent) + 'px')
                .hover(function () { return _this._tree.fireNodeMouseIn(_this); }, function () { return _this._tree.fireNodeMouseOut(_this); });
            var $item = $('<div/>').appendTo($itemContainer).addClass('item ' + this._getMimeClass());
            var $toggleWrapper = $('<div/>').appendTo($item).addClass('toggle-content-view');
            if (this._file.childCount > 0) {
                $('<div/>').appendTo($toggleWrapper).addClass('btn').click(function (_) { return _this.toggle(); });
            }
            var $icon = $('<div/>').appendTo($item).addClass('icon');
            var $name = $('<div/>').appendTo($item).addClass('name').text(this._file.name);
            var $actions = $('<div/>').appendTo($item).addClass('actions');
            var $refresh = $('<div/>').appendTo($actions).addClass('refresh').click(function (_) { return _this.refresh(); });
            var $add = $('<div/>').appendTo($actions).addClass('add');
            var $remove = $('<div/>').appendTo($actions).addClass('remove');
            var $contents = $('<div/>').appendTo(this._$this).addClass('content');
            if (this.nodes) {
                for (var i = 0, node; node = this.nodes[i]; i++) {
                    node.render();
                }
            }
        };
        FSTreeNode.prototype.toggle = function (cb) {
            if (this.isOpen)
                this.close(cb);
            else
                this.open(cb);
        };
        FSTreeNode.prototype.open = function (cb) {
            var _this = this;
            this._$this.addClass('open');
            this.isOpen = true;
            var $content = this._$this.children('.content').hide();
            this.refresh(function () {
                $content.slideDown(FSTreeNode._EFFECT_DURATION, function () {
                    _this._tree.fireTreeChange(_this);
                    cb && cb();
                });
            });
        };
        FSTreeNode.prototype.close = function (cb) {
            var _this = this;
            this._$this.removeClass('open');
            this.isOpen = false;
            var $content = this._$this.children('.content');
            $content.slideUp(FSTreeNode._EFFECT_DURATION, function () {
                $content.empty();
                _this.nodes = null;
                _this._tree.fireTreeChange(_this);
                cb && cb();
            });
        };
        FSTreeNode.prototype.refresh = function (cb) {
            var _this = this;
            this._$this.children('.content').empty();
            var absolutePath = this._file.absolutePath;
            async
                .newTask(function (cb) { return _this._db.getFileNode(absolutePath, cb); })
                .next(function (response) {
                if (!response.success) {
                    _this._env.log('Error refreshing "%s"', absolutePath);
                    return;
                }
                _this._file = response.result;
                var i = 0, asyncOps = new Array(_this._file.childCount);
                _this._file.forEachChild(function (child) {
                    asyncOps[i++] = (function (cb) {
                        return _this._db.getFileNode(_this._db.utils.getAbsolutePath({
                            name: child.name,
                            location: _this._file.absolutePath
                        }), cb);
                    });
                });
                // redundant lambda necessary for binding the context
                return function (cb) { return async.newTaskSeq(asyncOps).done(cb); };
            })
                .done(
            //function(...argArray : IArguments[]) => {
            function () {
                var argArray = [];
                for (var _i = 0; _i < arguments.length; _i++) {
                    argArray[_i - 0] = arguments[_i];
                }
                var response;
                var nodes = new Array(_this._file.childCount);
                for (var i = 0, args; args = argArray[i]; i++) {
                    response = args[0];
                    if (!response.success) {
                        _this._env.log('FAILURE: Could not open child of "%s".', _this._file.absolutePath);
                    }
                    nodes[i] = new FSTreeNode(response.result, _this._$this.children('.content'), _this._db, _this._env, _this._tree, _this._indent + 1);
                }
                // redundant lambda necessary for binding the context
                _this.nodes = nodes.sort(function (a, b) { return _this._compareFn(a, b); });
                for (var i = 0, node; node = _this.nodes[i]; i++) {
                    node.render();
                }
                cb && cb();
            });
        };
        FSTreeNode.prototype._compareType = function (a, b) {
            var aType = a._file.type, bType = b._file.type, aPriority = FSTreeNode._TYPE_ORDER[aType], bPriority = FSTreeNode._TYPE_ORDER[bType], aPriorityUndefined = typeof aPriority === 'undefined', bPriorityUndefined = typeof bPriority === 'undefined';
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
                return 0;
            }
            ;
            return aPriority > bPriority ? 1 : -1;
        };
        FSTreeNode.prototype._compareName = function (a, b) {
            if (a._file.name === b._file.name) {
                return 0;
            }
            return a._file.name > b._file.name ? 1 : -1;
        };
        FSTreeNode.prototype._compareFn = function (a, b) {
            var type = this._compareType(a, b);
            if (type != 0) {
                return type;
            }
            return this._compareName(a, b);
        };
        FSTreeNode._EFFECT_DURATION = 100;
        FSTreeNode._NOOP = function () { };
        FSTreeNode._TYPE_ORDER = (function () {
            //var order = {};
            var order = {};
            order["application/vnd.baz.solution"] = 1;
            order["application/vnd.baz.project"] = 2;
            order["applicatoin/vnd.baz.directory"] = 3;
            return order;
        })();
        return FSTreeNode;
    })();
    var FSTreeView = (function () {
        function FSTreeView(config) {
            var _this = this;
            this.indentAmount = config.indentAmount || 20;
            this._db = config.db;
            this._path = config.path || '/';
            this._env = config.environment || FSTreeView._DEFAULT_ENV;
            this._parentSel = config.parentSel;
            this._treeChangeHandlers = [];
            this._nodeMouseInHandlers = [];
            this._nodeMouseOutHandlers = [];
            this._nodeSelectHandlers = [];
            $(function () {
                _this.render();
                _this._openRoot();
            });
        }
        FSTreeView.prototype.render = function () {
            if (!this._$this) {
                this._$this = $('<div/>').addClass('tree-view').appendTo(this._parentSel);
            }
        };
        FSTreeView.prototype._openRoot = function () {
            var _this = this;
            async
                .newTask(function (cb) { return _this._db.getFileNode(_this._path, cb); })
                .done(function (response) {
                if (!response.success) {
                    _this._env.log("Failed to open FS root (tree-view.ts:FSTreeView:constructor)");
                }
                _this._root = new FSTreeNode(response.result, _this._$this, _this._db, _this._env, _this);
                _this._root.render();
                _this._root.open();
            });
        };
        FSTreeView.prototype.traverse = function (fn) {
            this._traverse(this._root, fn);
        };
        FSTreeView.prototype._traverse = function (startNode, fn) {
            if (!fn(startNode) || !startNode.isOpen || !startNode.nodes) {
                return;
            }
            for (var i = 0, node; node = startNode.nodes[i]; i++) {
                this._traverse(node, fn);
            }
        };
        FSTreeView.prototype.fireTreeChange = function (sender) {
            for (var i = 0, handler; handler = this._treeChangeHandlers[i]; i++) {
                handler(sender);
            }
        };
        FSTreeView.prototype.fireNodeSelect = function (sender) {
            for (var i = 0, handler; handler = this._nodeSelectHandlers[i]; i++) {
                handler(sender);
            }
        };
        FSTreeView.prototype.fireNodeMouseIn = function (sender) {
            for (var i = 0, handler; handler = this._nodeMouseInHandlers[i]; i++) {
                handler(sender);
            }
        };
        FSTreeView.prototype.fireNodeMouseOut = function (sender) {
            for (var i = 0, handler; handler = this._nodeMouseOutHandlers[i]; i++) {
                handler(sender);
            }
        };
        FSTreeView.prototype.onTreeChange = function (handler) {
            this._treeChangeHandlers.push(handler);
        };
        FSTreeView.prototype.onNodeHover = function (mouseIn, mouseOut) {
            this._nodeMouseInHandlers.push(mouseIn);
            this._nodeMouseOutHandlers.push(mouseOut);
        };
        FSTreeView.prototype.onNodeSelect = function (handler) {
            this._nodeSelectHandlers.push(handler);
        };
        FSTreeView._DEFAULT_ENV = { log: function (any) {
                var args = [];
                for (var _i = 1; _i < arguments.length; _i++) {
                    args[_i - 1] = arguments[_i];
                }
            } };
        return FSTreeView;
    })();
    exports.FSTreeView = FSTreeView;
});
