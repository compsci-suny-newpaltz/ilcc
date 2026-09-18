const express = require('express');
const { requireSSO, requireRole } = require('../middleware/auth');
const labs = require('../services/labs');
const router = express.Router();
router.use(requireSSO);

router.get('/admin', requireRole('admin'), (req, res) => res.json(labs.list(true)));
router.post('/admin', requireRole('admin'), (req, res, next) => {
  try { res.status(201).json(labs.create(req.body, req.user.email)); } catch (err) { next(err); }
});
router.put('/admin/:id', requireRole('admin'), (req, res, next) => {
  try { res.json(labs.update(req.params.id, req.body)); } catch (err) { next(err); }
});
router.get('/', (req, res) => res.json(labs.list()));
router.get('/:id', (req, res, next) => {
  try { res.json(labs.get(req.params.id)); } catch (err) { next(err); }
});
module.exports = router;
