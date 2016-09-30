var debug = require('debug')('plug'),
    path = require('path'),
    fs = require('fs'),
    events = require('events'),
    util = require('util'),
    cps = require('cps');

var Plugger = exports.Plugger = function() {
    this.plugins = {};
    this.pluginsLoaded = [];
    this.args = Array.prototype.slice.call(arguments, 0);
}; // PluginLoader

util.inherits(Plugger, events.EventEmitter);

var PluginState = exports.PluginState = Plugger.PluginState = {
  INACTIVE:0,
  ACTIVE:1,
  LOADED:2
};

Plugger.prototype.activate = function(pluginName, plugin, modulePath, data) {
    if(this.plugins[pluginName]) {
      debug('!! CONNECT: plugin "' + pluginName + '" already exists!');
      return;
    }
  
    // update the plugins
    this.plugins[pluginName] = {
        name: pluginName,
        data: data,
        module: plugin,
        path: modulePath,
        state: PluginState.INACTIVE
    };
  
    // add plugin to list of plugins loaded into memory
    if(this.pluginsLoaded.indexOf(pluginName)==-1) {
      this.pluginsLoaded.push(pluginName);
    }
};

Plugger.prototype.deactivate = function(pluginName,cb,doDrop) {
  if(this.pluginsLoaded.indexOf(pluginName)==-1) {
    debug('!! DISCONNECT: plugin "' + pluginName + '" is not loaded!');
    cb(null,false);
    return;
  }
  var activePlugin = this.plugins[pluginName],
      loader = this,
      disconnectArgs = this.args;
  
  function deactivatePlugin(result) {
    if(result!==true) {
      debug('!! DISCONNECT: plugin "' + pluginName + '" failed to deactivate!');
    }
    if(activePlugin) {
      activePlugin.state = PluginState.INACTIVE;
      if(doDrop) {
        loader.drop(pluginName);
        return cb(null,result);
      }
    }
    cb(null,result);
    loader.emit('disconnect',pluginName,result);
  }
  
  if(!(activePlugin.state & PluginState.ACTIVE)) {
    debug('!! DISCONNECT: plugin "' + pluginName + '" seems to be loaded, but is not active!');
    return deactivatePlugin(false);
  }
  
  var plugin = activePlugin.module;
  if(plugin.disconnect) {
    var haveCallback = plugin.disconnect.length>this.args.length,
        disconnectResult;
    
    if(haveCallback) {
      disconnectArgs = this.args.concat(function(result) {
        deactivatePlugin(result===undefined?disconnectResult:result);
      });
    }
    
    disconnectResult = plugin.disconnect.apply(null, disconnectArgs);
    
    if(!haveCallback) {
      deactivatePlugin(disconnectResult);
    }
  } else {
    debug('!! DISCONNECT: plugin "' + pluginName + '" had no disconnect method, this may cause memory leaks!');
    deactivatePlugin(true);
  }
};

Plugger.prototype.drop = function(pluginName) {
    var activePlugin = this.plugins[pluginName],
        loader = this;
        
    // if the plugin is already loaded, then drop it
    debug('check if drop required for plugin: ' + pluginName);
    if (activePlugin && activePlugin.state==PluginState.INACTIVE) {
        var dropActions = [];
        
        debug('!! DROP: active plugin found for "' + pluginName + '", attempting drop');
        if (activePlugin.module.drop) {
            dropActions = activePlugin.module.drop.apply(null, this.args) || [];
            if (! Array.isArray(dropActions)) {
                dropActions = [dropActions];
            }
        }
        
        // emit the drop event
        this.emit('drop', pluginName, activePlugin, dropActions);
        
        // iterate through the drop actions and fire events for each action
        dropActions.forEach(function(actionData) {
            if (actionData.action) {
                loader.emit(actionData.action, actionData);
            }
        });

        // delete the active plugin
        var i = this.pluginsLoaded.indexOf(pluginName);
        for(;i>-1;i=this.pluginsLoaded.indexOf(pluginName)) {
          this.pluginsLoaded.splice(i,1);
        }
        delete this.plugins[pluginName];
    }
};

Plugger.prototype.connect = function(callback) {
  var loader = this,
      plugs = this.pluginsLoaded.slice();
  
  function activatePlugin(pluginName,cb) {
    var activePlugin = loader.plugins[pluginName],
        connectArgs = loader.args;
    
    if(!activePlugin) {
      return cb(null,false);
    }
    
    var plugin = activePlugin.module;
    if(!plugin.connect) {
      return cb(null,false);
    }
    
    var haveCallback = plugin.connect.length > loader.args.length,
        connectResult;
    
    function callback(pluginData) {
        if(activePlugin.state>0) {
          return cb(null,true);
        }
        activePlugin.state = PluginState.ACTIVE;
        activePlugin.data = pluginData===undefined?connectResult:pluginData;
        loader.emit('connect',pluginName, pluginData || connectResult, activePlugin.path);
        cb(null,true);
    }

    // if the function has a callback parameter, then append the callback arg
    if (haveCallback) {
        // add the callback to the connect args
        connectArgs = loader.args.concat(callback);
    } 

    // call the connect method
    connectResult = plugin.connect.apply(null, connectArgs);

    // if we didn't have a callback, then emit the connect event
    if (! haveCallback) {
      callback();
    }
  }
  
  cps.pmap(plugs,activatePlugin,function(err,results) {
    if(err) {
      callback(err,null);
      return;
    }
    var bool = true;
    for(var i=0;i<results.length;i++) {
      bool = bool && results[i];
    }
    callback(null,bool);
  });
};

Plugger.prototype.disconnect = function(callback,doDrop) {
  var loader = this,
      plugs = this.pluginsLoaded.slice();
  
  function deactivatePlugin(pluginName, cb) {
    loader.deactivate(pluginName,cb,doDrop);
  }
  
  cps.pmap(plugs,deactivatePlugin,function(err,results) {
    if(err) {
      callback(err,null);
      return;
    }
    var bool = true;
    for(var i=0;i<results.length;i++) {
      bool = bool && results[i];
    }
    callback(null,bool);
  });
};

Plugger.prototype.count = function() {
  return this.pluginsLoaded.length;
};

Plugger.prototype.find = function(pluginPath) {
    var loader = this;
  
    function loadPlugin(modulePath,cb) {
      loader.load(modulePath);
      cb(null,true);
    }
    
    debug('looking for app plugins in: ' + pluginPath);
    fs.readdir(pluginPath, function(err, files) {
        var arr = (files || []);
        var queue = [];
        for(var i=0;i<arr.length;i++) {
          queue.push(path.join(pluginPath, arr[i]));
        }
        cps.pmap(queue,loadPlugin,function(err,results) {
          if(err) {
            loader.emit('error',err);
            return;
          }
          loader.connect(function(success) {
            var plugs = loader.pluginsLoaded.slice();
            cps.pmap(plugs,function(pluginName,cb) {
              var activePlugin = loader.plugins[pluginName],
                  loadArgs = loader.args,
                  loadResult;
              
              function callback(result) {
                var res = result===undefined?loadResult:result;
                cb(res!==false);
              }
              
              if(activePlugin && !(activePlugin.state & PluginState.LOADED)) {
                var plugin = activePlugin.module;
                var func = plugin.load || plugin.prepare;
                if(func) {
                  var haveCallback = func.length > loader.args.length;
                  
                  if(haveCallback) {
                    loadArgs = loader.args.concat(callback);
                  }
                  
                  loadResult = func.apply(null,loadArgs);
                  
                  if(!haveCallback) {
                    callback();
                  }
                } else {
                  callback(true);
                }
              }
            }, function(err,results) {
              if(err) {
                loader.emit('error',err);
                return;
              }
              var bool = true;
              for(var i=0;i<results.length;i++) {
                bool = bool && results[i];
              }
              loader.emit('connected',bool && success)
            });
          })
        });
    });
};

Plugger.prototype.load = function(modulePath) {
    // grab the base name of the plugin
    var pluginName = path.basename(modulePath, '.js'),
        plugin, connectArgs = this.args,
        loader = this;
        
    // drop the existing plugin if it exists
    loader.drop(pluginName, plugin);

    debug('loading plugin "' + pluginName + '" from: ' + modulePath);
    require.cache[modulePath] = undefined;

    try {
        // load the plugin
        plugin = require(modulePath);
    }
    catch (e) {
        loader.emit('error', e);
    }
    
    if (plugin && plugin.connect) {
        loader.activate(pluginName, plugin, modulePath, {});
    }
};

exports.create = function() {
    // create the new plugger
    var instance = new Plugger();
    
    // apply the constructor to pass through the arguments
    Plugger.apply(instance, Array.prototype.slice.call(arguments, 0));
    
    // return the new instance
    return instance;
};