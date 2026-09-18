const express = require('express');
const { requireSSO, requireRole } = require('../middleware/auth');
const labs = require('../services/labs');
const router = express.Router();
router.use(requireSSO);

// The management URL is kept for compatibility; registered TAs and admins
// share the same staff access used by the autograder.
router.get('/admin', requireRole('ta'), (req, res) => res.json(labs.list(true)));
router.post('/admin', requireRole('ta'), (req, res, next) => {
  try { res.status(201).json(labs.create(req.body, req.user.email)); } catch (err) { next(err); }
});
router.put('/admin/:id', requireRole('ta'), (req, res, next) => {
  try { res.json(labs.update(req.params.id, req.body)); } catch (err) { next(err); }
});
router.get('/', (req, res) => res.json(labs.list()));
router.get('/:id', (req, res, next) => {
  try { res.json(labs.get(req.params.id)); } catch (err) { next(err); }
});
module.exports = router;
