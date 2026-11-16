-- Audio shared from phone apps comes in more formats than the browser recorder makes.
update storage.buckets
set allowed_mime_types = array['application/pdf','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav',
  'audio/aac','audio/x-m4a','audio/flac','audio/opus','audio/3gpp','audio/amr']
where id = 'files';
