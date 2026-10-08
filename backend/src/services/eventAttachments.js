const fields = ['name', 'purpose', 'description', 'eventType', 'roomLayoutPreference', 'programmeDetails', 'equipmentNotes', 'specialArrangements', 'technicalSupportDetails', 'technicalSpecifications'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf', doc: 'application/msword' };

/** Validates per-question replacements/removals, decoded size and file signatures; caller-supplied MIME is ignored. */
function validateAttachments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Attachments must be a map of event questions.');
  }
  const result = {};
  for (const [field, file] of Object.entries(value)) {
    if (!fields.includes(field)) throw new Error('Attachments are not allowed for this question.');
    if (file === null) {
      result[field] = null;
      continue;
    }
    // Keep download names ordinary basenames, with bounded length and no path/control characters.
    if (!file || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255 || /[\x00-\x1f/\\]/.test(file.name)) {
      throw new Error('Choose a valid attachment filename.');
    }
    const extension = file.name.split('.').at(-1).toLowerCase();
    if (!types[extension]) throw new Error('Use PNG, JPG, JPEG, DOC or PDF files.');
    // Bound encoded input before allocating its decoded buffer, then verify the exact byte limit.
    if (typeof file.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data) || file.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
      throw new Error('Choose a valid file of up to 2 MB.');
    }
    const bytes = Buffer.from(file.data, 'base64');
    if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== file.data) {
      throw new Error('Choose a valid file of up to 2 MB.');
    }
    const signature = extension === 'png' ? Buffer.from('89504e470d0a1a0a', 'hex')
      : ['jpg', 'jpeg'].includes(extension) ? Buffer.from('ffd8ff', 'hex')
        : extension === 'doc' ? Buffer.from('d0cf11e0a1b11ae1', 'hex') : Buffer.from('%PDF-');
    if (!bytes.subarray(0, signature.length).equals(signature)) throw new Error('The file contents do not match its type.');
    result[field] = { name: file.name, type: types[extension], size: bytes.length, data: file.data };
  }
  return result;
}

/** Applies explicit replacements/removals without losing files belonging to other questions. */
function mergeAttachments(current, changes) {
  const result = { ...current };
  for (const [field, file] of Object.entries(changes)) {
    if (file === null) delete result[field];
    else result[field] = file;
  }
  return result;
}

module.exports = { fields, MAX_FILE_BYTES, validateAttachments, mergeAttachments };
