require("../config/loadEnv")

exports.verifyToken = (req, res) => {
  try {
    const { token } = req.body

    if (!token) {
      return res.status(400).json({
        message: "token required"
      })
    }

    // bandingkan dengan env
    if (token !== process.env.MASTER_TOKEN) {
      return res.status(401).json({
        message: "invalid token"
      })
    }

    // tandai session kalau kamu pakai session
    req.session = req.session || {}
    req.session.trusted = true

    return res.json({
      success: true,
      message: "token valid"
    })

  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
}
