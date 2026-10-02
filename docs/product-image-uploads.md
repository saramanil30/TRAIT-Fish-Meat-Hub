# Product photo uploads — storage setup

The ADMIN product form uploads photos straight to Supabase Storage. The browser converts each photo to an 800×800 WebP under 1 MB. The server checks the WebP signature and size, then uploads it with the signed-in staff session to `product-images/{business}/{product}/{sha256}.webp`. Finally it records the photo as the product's primary image through `api.save_product_image`.

This is the same bucket, path and limits that `scripts/resume-verified-images.mjs` uses.

The hosted project needs a one-time storage setup before uploads work. Until then, saving a product with a photo keeps the product changes and shows "Product saved, but the photo could not be uploaded".

## SQL to run once (SQL editor, igiujohtycixboaohjby)

```sql
BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('product-images','product-images',true,1048576,ARRAY['image/webp'])
ON CONFLICT(id) DO NOTHING;

-- Only an active ADMIN may write, and only under their own business and an existing product.
-- Lives in api because authenticated has no usage on app; it only answers yes/no for the caller.
CREATE OR REPLACE FUNCTION api.can_upload_product_image(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT object_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.webp$'
 AND app.current_staff_role()='ADMIN'
 AND EXISTS(SELECT 1 FROM app.products p JOIN app.staff_profiles sp ON sp.business_id=p.business_id
  WHERE sp.id=app.current_staff_profile_id()
  AND p.business_id::text=split_part(object_name,'/',1) AND p.id::text=split_part(object_name,'/',2))
$fn$;
REVOKE ALL ON FUNCTION api.can_upload_product_image(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION api.can_upload_product_image(text) TO authenticated;

CREATE POLICY "ADMIN uploads product photos" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='product-images' AND api.can_upload_product_image(name));
COMMIT;
```

Public reads use the bucket's public URL, so no read policy is needed. Uploads never overwrite (`x-upsert: false`). Re-uploading identical bytes is treated as already done.
