window.HTMLKeyboardOverlay = {
    targetObject: null,
    targetMethod: null,

    open: function(unityObjectName, unityMethodName, placeholder, currentText) {
        this.targetObject = unityObjectName;
        this.targetMethod = unityMethodName;

        const ov = document.getElementById("html-keyboard-overlay");
        const input = document.getElementById("html-kb-input");

        input.value = currentText || "";
        input.placeholder = placeholder || "";
        ov.style.display = "flex";

        setTimeout(() => input.focus(), 50);
    },

    submit: function() {
        const text = document.getElementById("html-kb-input").value;
        const ov = document.getElementById("html-keyboard-overlay");

        ov.style.display = "none";

        if (this.targetObject && this.targetMethod) {
            window.unityInstance.SendMessage(this.targetObject, this.targetMethod, text);
        }
    },

    cancel: function() {
        document.getElementById("html-keyboard-overlay").style.display = "none";
    }
};
