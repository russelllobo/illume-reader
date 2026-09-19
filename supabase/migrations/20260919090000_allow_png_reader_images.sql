-- Allow PNG reader images (GPT Image 2.5 renders PNG; previously webp-only).
update storage.buckets
set allowed_mime_types = array['image/webp', 'image/png']
where id = 'reader-images';
