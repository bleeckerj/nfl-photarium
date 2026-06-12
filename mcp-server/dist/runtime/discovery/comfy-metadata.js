import { inflateSync } from 'node:zlib';
function _tryParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function _extractFromMetadataMap(metadata, sourceLabel) {
    const workflowKeys = ['workflow', 'comfy_workflow', 'comfyui_workflow'];
    const promptKeys = ['prompt', 'comfy_prompt', 'parameters'];
    let workflow = null;
    for (const key of workflowKeys) {
        if (metadata[key]) {
            workflow = _tryParseJson(metadata[key]);
            if (workflow !== null)
                break;
        }
    }
    let prompt = null;
    for (const key of promptKeys) {
        if (metadata[key]) {
            prompt = _tryParseJson(metadata[key]);
            if (prompt !== null)
                break;
        }
    }
    if (!workflow || !prompt) {
        for (const value of Object.values(metadata)) {
            const parsed = _tryParseJson(value.trim());
            if (!parsed || typeof parsed !== 'object')
                continue;
            const obj = parsed;
            if (!workflow && obj.workflow !== undefined)
                workflow = obj.workflow;
            if (!prompt && obj.prompt !== undefined)
                prompt = obj.prompt;
            if (workflow && prompt)
                break;
        }
    }
    if (!workflow && !prompt) {
        return {
            found: false,
            workflow: null,
            prompt: null,
            rawMetadata: metadata,
            message: `No Comfy workflow/prompt JSON metadata found in ${sourceLabel}.`,
        };
    }
    return {
        found: true,
        workflow,
        prompt,
        rawMetadata: metadata,
    };
}
function _extractExifText(exifBuffer) {
    const out = {};
    if (exifBuffer.length < 14)
        return out;
    let tiffStart = 0;
    if (exifBuffer.subarray(0, 6).toString('ascii') === 'Exif\x00\x00') {
        tiffStart = 6;
    }
    if (tiffStart + 8 > exifBuffer.length)
        return out;
    const endian = exifBuffer.toString('ascii', tiffStart, tiffStart + 2);
    const le = endian === 'II';
    if (!le && endian !== 'MM')
        return out;
    const u16 = (off) => (le ? exifBuffer.readUInt16LE(off) : exifBuffer.readUInt16BE(off));
    const u32 = (off) => (le ? exifBuffer.readUInt32LE(off) : exifBuffer.readUInt32BE(off));
    const firstIfdRel = u32(tiffStart + 4);
    const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 7: 1 };
    const readIfd = (ifdRel, prefix = 'ifd') => {
        const ifdOff = tiffStart + ifdRel;
        if (ifdOff + 2 > exifBuffer.length)
            return;
        const count = u16(ifdOff);
        for (let i = 0; i < count; i += 1) {
            const entryOff = ifdOff + 2 + i * 12;
            if (entryOff + 12 > exifBuffer.length)
                break;
            const tag = u16(entryOff);
            const type = u16(entryOff + 2);
            const valueCount = u32(entryOff + 4);
            const valueOrOffset = u32(entryOff + 8);
            const unit = typeSizes[type] || 1;
            const byteLen = valueCount * unit;
            let raw;
            if (byteLen <= 4) {
                raw = exifBuffer.subarray(entryOff + 8, entryOff + 8 + byteLen);
            }
            else {
                const dataOff = tiffStart + valueOrOffset;
                if (dataOff + byteLen > exifBuffer.length)
                    continue;
                raw = exifBuffer.subarray(dataOff, dataOff + byteLen);
            }
            let decoded = null;
            if (type === 2) {
                decoded = raw.toString('utf8').replace(/\x00+$/g, '').trim();
            }
            else if (type === 7 || type === 1) {
                if (tag === 0x9286 && raw.length > 8) {
                    const payload = raw.subarray(8);
                    decoded = payload.toString('utf8').replace(/\x00+$/g, '').trim();
                }
                else {
                    decoded = raw.toString('utf8').replace(/\x00+$/g, '').trim();
                }
            }
            if (decoded) {
                out[`${prefix}_tag_${tag.toString(16)}`] = decoded;
                if (tag === 0x010e)
                    out.image_description = decoded;
                if (tag === 0x9286)
                    out.user_comment = decoded;
            }
            if (tag === 0x8769 && valueOrOffset > 0) {
                readIfd(valueOrOffset, `${prefix}_exif`);
            }
        }
    };
    if (firstIfdRel > 0)
        readIfd(firstIfdRel);
    return out;
}
function extractComfyMetadataFromJpeg(buffer) {
    const metadata = {};
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return {
            found: false,
            workflow: null,
            prompt: null,
            rawMetadata: metadata,
            message: 'Not a JPEG file.',
        };
    }
    let offset = 2;
    let commentIndex = 0;
    while (offset + 4 <= buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        while (offset < buffer.length && buffer[offset] === 0xff)
            offset += 1;
        if (offset >= buffer.length)
            break;
        const marker = buffer[offset];
        offset += 1;
        if (marker === 0xd9 || marker === 0xda)
            break;
        if (offset + 2 > buffer.length)
            break;
        const len = buffer.readUInt16BE(offset);
        if (len < 2 || offset + len > buffer.length)
            break;
        const data = buffer.subarray(offset + 2, offset + len);
        if (marker === 0xe1) {
            if (data.subarray(0, 6).toString('ascii') === 'Exif\x00\x00') {
                Object.assign(metadata, _extractExifText(data));
            }
            else if (data.subarray(0, 29).toString('ascii').startsWith('http://ns.adobe.com/xap/1.0/')) {
                const xmp = data.subarray(29).toString('utf8').replace(/\x00+$/g, '').trim();
                if (xmp)
                    metadata.xmp = xmp;
            }
        }
        else if (marker === 0xfe) {
            const txt = data.toString('utf8').replace(/\x00+$/g, '').trim();
            if (txt)
                metadata[`comment_${commentIndex++}`] = txt;
        }
        offset += len;
    }
    return _extractFromMetadataMap(metadata, 'JPEG metadata segments');
}
function extractComfyMetadataFromWebp(buffer) {
    const metadata = {};
    if (buffer.length < 12
        || buffer.subarray(0, 4).toString('ascii') !== 'RIFF'
        || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') {
        return {
            found: false,
            workflow: null,
            prompt: null,
            rawMetadata: metadata,
            message: 'Not a WebP file.',
        };
    }
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const chunkType = buffer.subarray(offset, offset + 4).toString('ascii');
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const dataOff = offset + 8;
        const dataEnd = dataOff + chunkSize;
        if (dataEnd > buffer.length)
            break;
        const data = buffer.subarray(dataOff, dataEnd);
        if (chunkType === 'EXIF') {
            Object.assign(metadata, _extractExifText(data));
        }
        else if (chunkType === 'XMP ') {
            const xmp = data.toString('utf8').replace(/\x00+$/g, '').trim();
            if (xmp)
                metadata.xmp = xmp;
        }
        offset = dataEnd + (chunkSize % 2);
    }
    return _extractFromMetadataMap(metadata, 'WebP EXIF/XMP chunks');
}
function extractComfyMetadataFromPng(buffer) {
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngSignature)) {
        return {
            found: false,
            workflow: null,
            prompt: null,
            rawMetadata: {},
            message: 'Not a PNG file; Comfy workflow extraction currently supports PNG embedded metadata.',
        };
    }
    const metadata = {};
    let offset = 8;
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        offset += 4;
        const chunkType = buffer.toString('ascii', offset, offset + 4);
        offset += 4;
        if (offset + length + 4 > buffer.length) {
            break;
        }
        const chunkData = buffer.subarray(offset, offset + length);
        offset += length;
        offset += 4; // crc
        if (chunkType === 'tEXt') {
            const sep = chunkData.indexOf(0);
            if (sep > 0) {
                const key = chunkData.subarray(0, sep).toString('utf8');
                const value = chunkData.subarray(sep + 1).toString('utf8');
                metadata[key] = value;
            }
        }
        else if (chunkType === 'zTXt') {
            const sep = chunkData.indexOf(0);
            if (sep > 0 && sep + 2 <= chunkData.length) {
                const key = chunkData.subarray(0, sep).toString('utf8');
                const compressed = chunkData.subarray(sep + 2);
                try {
                    metadata[key] = inflateSync(compressed).toString('utf8');
                }
                catch {
                    // ignore malformed chunk
                }
            }
        }
        else if (chunkType === 'iTXt') {
            const sep0 = chunkData.indexOf(0);
            if (sep0 > 0 && sep0 + 3 <= chunkData.length) {
                const key = chunkData.subarray(0, sep0).toString('utf8');
                const compressionFlag = chunkData[sep0 + 1];
                const afterFlag = sep0 + 3;
                const sep1 = chunkData.indexOf(0, afterFlag); // language
                if (sep1 >= 0) {
                    const sep2 = chunkData.indexOf(0, sep1 + 1); // translated keyword
                    if (sep2 >= 0) {
                        const textBytes = chunkData.subarray(sep2 + 1);
                        try {
                            metadata[key] = (compressionFlag === 1 ? inflateSync(textBytes) : textBytes).toString('utf8');
                        }
                        catch {
                            // ignore malformed chunk
                        }
                    }
                }
            }
        }
        if (chunkType === 'IEND') {
            break;
        }
    }
    return _extractFromMetadataMap(metadata, 'PNG text chunks');
}
export function extractComfyMetadata(buffer, contentType, filename) {
    const lowerType = (contentType || '').toLowerCase();
    const lowerName = (filename || '').toLowerCase();
    const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
    const isWebp = buffer.length >= 12
        && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (isPng || lowerType.includes('png') || lowerName.endsWith('.png')) {
        const result = extractComfyMetadataFromPng(buffer);
        return { ...result, format: 'png' };
    }
    if (isJpeg || lowerType.includes('jpeg') || lowerType.includes('jpg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
        const result = extractComfyMetadataFromJpeg(buffer);
        return { ...result, format: 'jpeg' };
    }
    if (isWebp || lowerType.includes('webp') || lowerName.endsWith('.webp')) {
        const result = extractComfyMetadataFromWebp(buffer);
        return { ...result, format: 'webp' };
    }
    return {
        found: false,
        workflow: null,
        prompt: null,
        rawMetadata: {},
        format: 'unknown',
        message: 'Unsupported artifact format for embedded workflow extraction. Supported: PNG, JPEG, WebP.',
    };
}
