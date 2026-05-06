require('dotenv').config();
const pool = require('../src/config/database');
pool.query(`SELECT lf.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', lfi.id,
            'image_url', lfi.image_url,
            'image_fingerprint', lfi.image_fingerprint
          )
        ) FILTER (WHERE lfi.id IS NOT NULL),
        '[]'
      ) AS images
     FROM lost_found lf
     LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
     WHERE lf.id = $1
     GROUP BY lf.id`, ['00000000-0000-0000-0000-000000000000'])
  .then(res => { console.log('success'); pool.end(); })
  .catch(err => { console.log('error', err); pool.end(); });
