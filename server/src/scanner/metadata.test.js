const { ExifDateTime } = require('exiftool-vendored');
const { selectCaptureTime } = require('./metadata');

describe('media capture time selection', () => {
  test('prefers DateTimeOriginal over generic creation metadata', () => {
    const result = selectCaptureTime({
      DateTimeOriginal: ExifDateTime.fromEXIF('2021:06:12 13:29:10+08:00'),
      CreateDate: ExifDateTime.fromEXIF('2024:01:01 00:00:00+08:00'),
    });

    expect(result).toMatchObject({
      captured_at: Date.parse('2021-06-12T05:29:10.000Z'),
      captured_local_ms: Date.parse('2021-06-12T13:29:10.000Z'),
      time_zone: 'UTC+8',
      time_source: 'embedded',
      time_tag: 'DateTimeOriginal',
      time_confidence: 'high',
    });
  });

  test('keeps timezone-less wall time independent from the server timezone', () => {
    const result = selectCaptureTime({ DateTimeOriginal: '2016:11:01 13:05:57' });
    expect(result.captured_at).toBe(Date.parse('2016-11-01T13:05:57.000Z'));
    expect(result.captured_local_ms).toBe(Date.parse('2016-11-01T13:05:57.000Z'));
    expect(result.time_zone).toBeNull();
  });

  test('does not promote ModifyDate to a capture time', () => {
    expect(selectCaptureTime({ ModifyDate: '2021:12:28 14:20:03' })).toBeNull();
  });

  test('marks generic media creation tags as medium confidence', () => {
    expect(selectCaptureTime({ MediaCreateDate: '2020:03:16 17:12:27Z' })).toMatchObject({
      time_tag: 'MediaCreateDate',
      time_confidence: 'medium',
    });
  });
});
