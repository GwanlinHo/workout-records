/* IndexedDB 存取層：紀錄（records）與設定（kv）。資料只存在本機，永不刪除舊資料 */
(function (root) {
  "use strict";
  var DB_NAME = "workout-records";
  var DB_VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("records")) {
          var s = db.createObjectStore("records", { keyPath: "id" });
          s.createIndex("dateKey", "dateKey");
        }
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var result;
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
        result = fn(t.objectStore(store));
      });
    });
  }

  function reqValue(req, holder) {
    req.onsuccess = function () { holder.value = req.result; };
  }

  var DB = {
    putRecord: function (rec) {
      return tx("records", "readwrite", function (s) { s.put(rec); return rec; });
    },
    putRecords: function (list) {
      return tx("records", "readwrite", function (s) {
        list.forEach(function (r) { s.put(r); });
        return list.length;
      });
    },
    deleteRecord: function (id) {
      return tx("records", "readwrite", function (s) { s.delete(id); });
    },
    getRecord: function (id) {
      var h = {};
      return tx("records", "readonly", function (s) { reqValue(s.get(id), h); }).then(function () { return h.value; });
    },
    /* dateKey 介於 fromKey 與 toKey（含） */
    rangeRecords: function (fromKey, toKey) {
      var h = {};
      return tx("records", "readonly", function (s) {
        reqValue(s.index("dateKey").getAll(IDBKeyRange.bound(fromKey, toKey)), h);
      }).then(function () {
        return (h.value || []).sort(function (a, b) { return a.start - b.start; });
      });
    },
    allRecords: function () {
      var h = {};
      return tx("records", "readonly", function (s) { reqValue(s.getAll(), h); }).then(function () {
        return (h.value || []).sort(function (a, b) { return a.start - b.start; });
      });
    },
    getKV: function (key) {
      var h = {};
      return tx("kv", "readonly", function (s) { reqValue(s.get(key), h); }).then(function () { return h.value; });
    },
    setKV: function (key, value) {
      return tx("kv", "readwrite", function (s) { s.put(value, key); });
    },
    /* 要求瀏覽器把資料標為「持久」，降低被系統清除的機率 */
    persist: function () {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persisted().then(function (p) {
          return p || navigator.storage.persist();
        }).catch(function () { return false; });
      }
      return Promise.resolve(false);
    },
  };
  root.WRDB = DB;
})(self);
