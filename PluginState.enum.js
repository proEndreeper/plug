(function(){
  const PluginStates = {
          INACTIVE:0,
          ACTIVE:1,
          LOADED:2
        };
  var props = {};
  
  function Enum(name,val) {
    Object.defineProperties(this,{
      _name:{
        configurable:false,
        writable:false,
        enumerable:true,
        value:name
      },
      _value:{
        configurable:false,
        writable:false,
        enumerable:true,
        value:val
      }
    });
  }
  
  Enum.prototype = {
    toString:function() {
      return this._name;
    },
    getName:function() {
      return this.toString();
    },
    intVal:function() {
      return this._value;
    }
  }
  var k,kUpper,v,enu;
  for(k in PluginStates) {
    v = PluginStates[k];
    kUpper = k.toUpperCase();
    enu = new Enum(kUpper,v);
    props[kUpper]={
      configurable:false,
      writable:false,
      enumerable:true,
      value:enu
    };
    props[v.toString()]={
      configurable:false,
      writable:false,
      enumerable:true,
      value:enu
    };
  }
  
  props.get={
    configurable:false,
    enumerable:true,
    writable:false,
    value:function(key) {
      if(this[key] instanceof Enum) {
        return this[key];
      }
      return null;
    }
  }
  
  props.asString={
    configurable:false,
    enumerable:true,
    writable:false,
    value:function(enu) {
      if(!(enu instanceof Enum)) {
        enu = this.get(enu);
      }
      if(enu instanceof Enum) {
        return enu.toString();
      }
      return null;
    }
  }
  
  var PluginState = {};
  Object.defineProperties(PluginState,props);
  module.exports = PluginState;
})()