export function textResult(text) {
    return { content: [{ type: 'text', text }] };
}
export function jsonResult(value) {
    return textResult(JSON.stringify(value, null, 2));
}
export function errorResult(text) {
    return { ...textResult(text), isError: true };
}
