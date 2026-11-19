// Browser hints are not a security boundary. The server validates bytes again.
export function validatePhotoFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const expected = extension === 'png' ? 'image/png' :
    extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : null;
  if (!expected) return 'Можна завантажувати лише фото JPG, JPEG або PNG.';
  if (file.type && file.type !== expected) return 'Формат файлу не відповідає його розширенню.';
  if (file.size <= 0) return 'Файл порожній.';
  if (file.size > 10 * 1024 * 1024) return 'Фото не може бути більшим за 10 МБ.';
  return null;
}
