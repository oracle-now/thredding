function copyToClipboard(element) {
    const text = document.querySelector(element)?.textContent;
    if (!text) return;

    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Installer Command Copied To Clipboard!\r\n\r\nNext Paste It In Your Command Prompt/Terminal...');
        }).catch(() => {
            _legacyCopy(text);
        });
    } else {
        _legacyCopy(text);
    }
}

function _legacyCopy(text) {
    const temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    alert('Installer Command Copied To Clipboard!\r\n\r\nNext Paste It In Your Command Prompt/Terminal...');
}