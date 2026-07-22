(function () {
    'use strict';
    if (window.top !== window.self) {
        document.documentElement.setAttribute('data-framed', 'true');
        document.documentElement.style.display = 'none';
    }
})();
