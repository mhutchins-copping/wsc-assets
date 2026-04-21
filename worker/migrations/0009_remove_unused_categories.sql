-- Trim the default category list to what the council actually tracks.
-- Infrastructure (server / UPS / NVR / camera) is out of scope for this
-- register -- that gear is tracked elsewhere or treated as fixed
-- infrastructure not needing lifecycle tracking.
--
-- Safety: only delete a category if no assets currently reference it.
-- Anything the user has manually categorised under one of these sticks
-- around; they can re-map or clean up through the Categories UI.

DELETE FROM categories
WHERE id IN (
  'cat_server',
  'cat_ups',
  'cat_nvr',
  'cat_camera'
)
AND id NOT IN (SELECT DISTINCT category_id FROM assets WHERE category_id IS NOT NULL);

-- Parent goes away only if all its children are gone and nothing else
-- (asset or child category) still points at it.
DELETE FROM categories
WHERE id = 'cat_infra'
  AND id NOT IN (SELECT DISTINCT category_id FROM assets WHERE category_id IS NOT NULL)
  AND id NOT IN (SELECT DISTINCT parent_id FROM categories WHERE parent_id IS NOT NULL);
