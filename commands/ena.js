const axios = require("axios");
const { sendLongText } = require("../utils/handleLongText");
const User = require("../models/User");
const People = require("../models/People");
const { startKeyboard } = require("../utils/keyboards");
const ENAPromoNames = require("../json/promosEna.json");

function cleanInput(input) {
  input = input.trim().toLowerCase();
  // replace accents
  input = input.replace(/[àáâãäå]/g, "a");
  input = input.replace(/[èéêë]/g, "e");
  input = input.replace(/[ìíîï]/g, "i");
  input = input.replace(/[òóôõö]/g, "o");
  input = input.replace(/[ùúûü]/g, "u");
  input = input.replace(/[ç]/g, "c");
  // split input into array of words
  input = input.split(" ");
  return input;
}

// https://stackoverflow.com/questions/53606337/check-if-array-contains-all-elements-of-another-array
let checker = (arr, target) => target.every((v) => arr.includes(v));

// find corresponding promo value depending on user input.
// if not found, return false
// user can enter either first name, last name or full name
function findPromoName(input) {
  let promoNames = Object.keys(ENAPromoNames).map((name) => name.split(" "));
  input = cleanInput(input);
  // TODO: check if multiple promo names have the same first name => eg: 'georges' is in 'georges clemenceau' and 'georges orwell'
  for (let i = 0; i < promoNames.length; i++) {
    if (checker(promoNames[i], input)) {
      return ENAPromoNames[Object.keys(ENAPromoNames)[i]];
    }
  }
  return false;
}

async function getJORFSearchResult(year) {
  let url = `https://jorfsearch.steinertriples.ch/tag/eleve_ena=%22${year}%22?format=JSON`;
  const res = await axios.get(url).then((response) => {
    return response.data;
  });
  return res;
}

function capitalizeFirstLetters(string) {
  try {
    return string.replace(/\b\w/g, (l) => l.toUpperCase());
  } catch (e) {
    // catching errors in case characters are not letters
    return false;
  }
}

async function searchPersonOnJORF(personString) {
  return await axios
    .get(
      encodeURI(
        `https://jorfsearch.steinertriples.ch/name/${personString}?format=JSON`
      )
    )
    .then(async (res) => {
      if (res.data?.length === 0) {
        return res;
      }
      if (res.request.res.responseUrl) {
        return await axios.get(
          res.request.res.responseUrl.endsWith("?format=JSON")
            ? res.request.res.responseUrl
            : `${res.request.res.responseUrl}?format=JSON`
        );
      }
    });
}

function isPersonAlreadyFollowed(id, followedPeople) {
  return followedPeople.some((person) => person.peopleId.equals(id));
}

module.exports = (bot) => async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = `Entrez le nom de votre promo (ENA) et l'*intégralité de ses élèves* sera ajoutée à la liste de vos contacts.\n
⚠️ Attention, beaucoup de personnes seront ajoutées en même temps, *les retirer peut ensuite prendre du temps* ⚠️`;
    const question = await bot.sendMessage(msg.chat.id, text, {
      parse_mode: "Markdown",
      reply_markup: {
        force_reply: true,
      },
    });
    let JORFSearchRes;
    await bot.onReplyToMessage(chatId, question.message_id, async (msg) => {
      const yearString = findPromoName(msg.text);
      let studentsList;
      JORFSearchRes = await getJORFSearchResult(yearString);
      const promoName = Object.keys(ENAPromoNames).find(
        (key) => ENAPromoNames[key] === yearString
      );
      let text = `La promotion *${capitalizeFirstLetters(
        promoName
      )}* contient *${JORFSearchRes.length} élèves*:`;
      if (JORFSearchRes.length > 0) {
        studentsList = await bot.sendMessage(chatId, text, {
          parse_mode: "Markdown",
        });
      } else {
        return await bot.sendMessage(
          chatId,
          "Promo introuvable",
          startKeyboard
        );
      }
      // wait 2 seconds
      await new Promise((resolve) => setTimeout(resolve, 2000));
      // sort JORFSearchRes by last name
      JORFSearchRes.sort((a, b) => {
        if (a.nom < b.nom) return -1;
        if (a.nom > b.nom) return 1;
        return 0;
      });
      // send all contacts
      const contacts = JORFSearchRes.map((contact) => {
        return `${contact.nom} ${contact.prenom}`;
      });
      await sendLongText(bot, chatId, contacts.join("\n"), {
        expectsAnswer: true,
        nextMessageId: studentsList.message_id + 1,
        returnMessageId: true,
        maxLength: 3000,
      });
      const followConfirmation = await bot.sendMessage(
        chatId,
        `Voulez-vous ajouter ces personnes à vos contacts ? (répondez *oui* ou *non*)\n\n⚠️ Attention : *les retirer peut ensuite prendre du temps*`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            force_reply: true,
          },
        }
      );
      await bot.onReplyToMessage(
        chatId,
        followConfirmation.message_id,
        async (msg) => {
          if (new RegExp(/oui/i).test(msg.text)) {
            console.log(`ENA function was used for promo ${promoName}`);
            await bot.sendMessage(
              chatId,
              `Ajout en cours... Cela peut prendre plusieurs minutes. ⏰`
            );
            const tgUser = msg.from;
            let user = await User.firstOrCreate(tgUser, chatId);
            for (let i = 0; i < JORFSearchRes.length; i++) {
              const contact = JORFSearchRes[i];
              const search = await searchPersonOnJORF(
                `${contact.prenom} ${contact.nom}`
              );
              if (search.data?.length) {
                const people = await People.firstOrCreate({
                  nom: search.data[0].nom,
                  prenom: search.data[0].prenom,
                  lastKnownPosition: search.data[0],
                });
                await people.save();
                // only add to followedPeople if user is not already following this person
                if (!isPersonAlreadyFollowed(people._id, user.followedPeople)) {
                  user.followedPeople.push({
                    peopleId: people._id,
                    lastUdpate: Date.now(),
                  });
                }
              }
            }
            await user.save();
            await bot.sendMessage(
              chatId,
              `Les *${
                JORFSearchRes.length
              } personnes* de la promo *${capitalizeFirstLetters(
                promoName
              )}* ont été ajoutées à vos contacts.`,
              startKeyboard
            );
          } else if (new RegExp(/non/i).test(msg.text)) {
            await bot.sendMessage(
              chatId,
              `Ok, aucun ajout n'a été effectué. 👌`
            );
          } else {
            await bot.sendMessage(
              chatId,
              `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /ena.`
            );
          }
        }
      );
    });
  } catch (error) {
    console.log(error);
  }
};
