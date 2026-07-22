(function () {
    'use strict';

    var localHost = location.protocol === 'file:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.hostname === '[::1]';
    var values = Object.create(null);
    var memoryStorage = {
        get length() { return Object.keys(values).length; },
        key: function (index) { return Object.keys(values)[index] || null; },
        getItem: function (key) {
            key = String(key);
            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
        },
        setItem: function (key, value) { values[String(key)] = String(value); },
        removeItem: function (key) { delete values[String(key)]; },
        clear: function () { values = Object.create(null); }
    };
    var isolated = false;

    try {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: memoryStorage
        });
        isolated = window.localStorage === memoryStorage;
    } catch (e) {
        isolated = false;
    }

    window.FireTest = {
        allowed: localHost && isolated,
        storage: memoryStorage
    };
})();
