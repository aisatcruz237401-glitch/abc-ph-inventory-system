const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { supabase, isSupabaseEnabled } = require('../config/supabase');

router.get('/', async (req, res) => {
  try {
    if (isSupabaseEnabled && supabase) {
      const { data, error } = await supabase.from('branches').select('*').order('branch_name', { ascending: true });
      if (!error && data) return res.json(data.map((row) => ({ ...row, id: row.id || row.uuid, branch_name: row.branch_name || row.name || 'Unknown' })));
      if (error) {
        if (['PGRST205', '42703'].includes(error.code)) return res.json([]);
        console.warn('Supabase branch fetch failed:', error.message);
      }
    }

    if (!pool) return res.status(500).json({ message: 'Database is not configured for this environment' });

    const [rows] = await pool.query('SELECT id, branch_code, branch_name, status FROM branches ORDER BY branch_name');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch branches', error: error.message });
  }
});

module.exports = router;
