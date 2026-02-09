const express = require("express")
const router = express.Router()

const { verifyToken } = require("../controller/tokencontroller")

router.post("/verify-token", verifyToken)

module.exports = router
