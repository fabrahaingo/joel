const axios = require("axios");

const send = (name, data) => {
  const payload = {
    payload: {
      hostname: process.env.UMAMI_HOST,
      website: process.env.UMAMI_ID,
      name: name,
      data: data,
    },
    type: "event",
  };

  axios.post(`https://${process.env.UMAMI_HOST}/api/send`, payload, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0",
    },
  });
};

module.exports = { send };
