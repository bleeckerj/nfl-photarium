export async function copyUrlToClipboard(url: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      alert('URL copied to clipboard!');
      return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = url;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand('copy');
      alert('URL copied to clipboard!');
    } catch (fallbackErr) {
      console.error('Fallback copy failed: ', fallbackErr);
      prompt('Copy this URL manually:', url);
    }

    document.body.removeChild(textArea);
  } catch (err) {
    console.error('Failed to copy: ', err);
    prompt('Copy this URL manually:', url);
  }
}
