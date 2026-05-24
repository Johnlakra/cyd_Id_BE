// routes/anubhav.js - Mount point for the Anubhav Retreat 2026 event module.
// All routes are namespaced under /anubhav. Additive only; nothing existing is touched.
// Phase 1 (registration/fees), Phase 2 (accommodation/PDFs), and Phase 3 (timetable/
// announcements) will plug in here as separate sub-routers.
const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { loadEventRole, requireEventRole, requirePlaceAccess } = require('../middleware/anubhavRole');
const roleController = require('../controllers/anubhavRoleController');
const chaperoneController = require('../controllers/anubhavChaperoneController');
const registrationController = require('../controllers/anubhavRegistrationController');
const accommodationController = require('../controllers/anubhavAccommodationController');
const allotmentController = require('../controllers/anubhavAllotmentController');
const timetableController = require('../controllers/anubhavTimetableController');
const announcementController = require('../controllers/anubhavAnnouncementController');
const participantController = require('../controllers/anubhavParticipantController');

// Phase 1 endpoints all require an event role (LOC or DEXCO) and a valid place.
// requirePlaceAccess additionally enforces LOC -> loc_place scoping.
const eventStaff = [requireEventRole(['loc', 'dexco']), requirePlaceAccess];

// Every /anubhav route requires a logged-in user and loads their event role.
router.use(authenticateToken, loadEventRole);

// @route   GET /anubhav/me/role
// @desc    Get the caller's event_role + loc_place
// @access  Authenticated
router.get('/me/role', roleController.getMyRole);

// @route   GET /anubhav/my/event
// @desc    Participant self-view: registration, room+roommates, timetable, live, announcements.
//          Self-scoped (resolved from req.user.id) — no place param, no role gate.
// @access  Authenticated (any user, including youth with no event role)
router.get('/my/event', participantController.getMyEvent);

// @route   POST /anubhav/roles/grant
// @desc    Grant an event role to a profile holder (admin or DEXCO)
// @access  Authenticated; admin grants any role, DEXCO grants only LOC
router.post('/roles/grant', roleController.grantRole);

// @route   GET /anubhav/roles
// @desc    List users currently holding an event role
// @access  Authenticated; admin only
router.get('/roles', (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
}, roleController.listRoles);

// @route   GET /anubhav/users/search?q=
// @desc    Search profiles by name/phone; returns linked user + event_role (for role management UI)
// @access  Admin only
router.get('/users/search', (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
}, roleController.searchUsers);

// ---------- Phase 1: Registration + Fees ----------

// @route   GET /anubhav/eligible?place=&deanery=&parish=&search=
// @desc    Youth from this place's deaneries who are not yet registered here
router.get('/eligible', eventStaff, registrationController.listEligible);

// @route   POST /anubhav/chaperones
// @desc    Create a chaperone (Sister/Catechist) for a parish in this place
router.post('/chaperones', eventStaff, chaperoneController.createChaperone);

// @route   GET /anubhav/chaperones?place=&parish=
// @desc    List chaperones for a place (optional parish filter)
router.get('/chaperones', eventStaff, chaperoneController.listChaperones);

// @route   POST /anubhav/registrations
// @desc    Register an eligible youth into this place
router.post('/registrations', eventStaff, registrationController.createRegistration);

// @route   GET /anubhav/registrations?place=&deanery=&parish=
// @desc    List registered youth + counts + fee total for this place
router.get('/registrations', eventStaff, registrationController.listRegistrations);

// @route   DELETE /anubhav/registrations/:id
// @desc    Un-register a youth (soft delete). LOC scope checked in controller
//          because the URL does not carry `place`.
router.delete(
    '/registrations/:id',
    requireEventRole(['loc', 'dexco']),
    registrationController.deleteRegistration
);

// @route   GET /anubhav/fees?place=
// @desc    Fee breakdown for a place + overall across all places
router.get('/fees', eventStaff, registrationController.getFees);

// ---------- Phase 2: Accommodation ----------

// @route   POST /anubhav/buildings   body: { place, name }
router.post('/buildings', eventStaff, accommodationController.createBuilding);

// @route   GET  /anubhav/buildings?place=
// @desc    Nested buildings -> floors -> rooms with occupancy / vacancy
router.get('/buildings', eventStaff, accommodationController.listBuildings);

// /floors and /rooms POST carry no `place`; place is derived from the parent.
// Only the event-role check happens here; place scoping is enforced in-controller.
router.post('/floors',     requireEventRole(['loc', 'dexco']), accommodationController.createFloor);
router.post('/rooms',      requireEventRole(['loc', 'dexco']), accommodationController.createRoom);
router.post('/allotments/batch', requireEventRole(['loc', 'dexco']), allotmentController.createAllotmentBatch);
router.post('/allotments', requireEventRole(['loc', 'dexco']), allotmentController.createAllotment);
router.delete('/allotments/:id', requireEventRole(['loc', 'dexco']), allotmentController.deleteAllotment);

// @route   GET /anubhav/rooming?place=&building_id?&floor_id?&room_id?
// @desc    Hierarchical data shaped for client-side jsPDF rendering
router.get('/rooming', eventStaff, accommodationController.getRoomingData);

// ---------- Phase 3: Timetable + Announcements + Live view ----------

// Timetable reads are open to any authenticated user (so youth see their schedule);
// mutations are LOC/DEXCO. /timetable/live is a public read for the place.
router.get('/timetable/live', timetableController.getLive);
router.get('/timetable',      timetableController.listItems);

router.post('/timetable',         eventStaff,                          timetableController.createItem);
router.put('/timetable/:id',      requireEventRole(['loc', 'dexco']),  timetableController.updateItem);
router.delete('/timetable/:id',   requireEventRole(['loc', 'dexco']),  timetableController.deleteItem);

// Announcement reads are open to any authenticated user.
// POST/DELETE require LOC/DEXCO; diocese-wide (place=null) is DEXCO-only (in controller).
router.get('/announcements',  announcementController.listAnnouncements);
router.post('/announcements',     requireEventRole(['loc', 'dexco']),  announcementController.createAnnouncement);
router.delete('/announcements/:id', requireEventRole(['loc', 'dexco']), announcementController.deleteAnnouncement);

module.exports = router;
