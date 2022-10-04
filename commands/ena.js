const axios = require("axios")
const { sendLongText } = require("../utils/handleLongText")
const User = require("../models/User")
const People = require("../models/People")
const { startKeyboard } = require("../utils/keyboards")

const ENAPromoNames = {
    'germaine tillion': '2021-2022',
    'aime cesaire': '2020-2021',
    'hannah arendt': '2019-2020',
    'moliere': '2018-2019',
    'georges clemenceau': '2017-2018',
    'louise weiss': '2016-2017',
    'georges orwell': '2015-2016',
    'winston churchill': '2014-2015',
    'jean de la fontaine': '2013-2014',
    'jean zay': '2012-2013',
    'marie curie': '2011-2012',
    'jean-jacques rousseau': '2010-2011',
    'robert badinter': '2009-2011',
    'emile zola': '2008-2010',
    'willy brandt': '2007-2009',
    'aristide briand': '2006-2008',
    'republique': '2005-2007',
    'simone veil': '2004-2006',
    'romain gary': '2003-2005',
    'leopold sedar senghor': '2002-2004',
    'rene cassin': '2001-2003',
    'copernic': '2000-2002',
    'nelson mandela': '1999-2001',
    'averroes': '1998-2000',
    'cyrano de bergerac': '1997-1999',
    'valmy': '1996-1998',
    'marc bloch': '1995-1997',
    'victor schoelcher': '1994-1996',
    'rene char': '1993-1995',
    'antoine de saint-exupery': '1992-1994',
    'leon gambetta': '1991-1993',
    'condorcet': '1990-1992',
    'victor hugo': '1989-1991',
    'jean monnet': '1988-1990',
    'liberte egalite fraternite': '1987-1989',
    'michel de montaigne': '1986-1988',
    'fernand braudel': '1985-1987',
    'denis diderot': '1984-1986',
    'leonard de vinci': '1983-1985',
    'louise michel': '1982-1984',
    'solidarite': '1981-1983',
    'henri-francois d\'aguesseau': '1980-1982',
}

function cleanInput(input) {
    input = input.trim().toLowerCase()
    // replace accents
    input = input.replace(/[àáâãäå]/g, "a")
    input = input.replace(/[èéêë]/g, "e")
    input = input.replace(/[ìíîï]/g, "i")
    input = input.replace(/[òóôõö]/g, "o")
    input = input.replace(/[ùúûü]/g, "u")
    input = input.replace(/[ç]/g, "c")
    // split input into array of words
    input = input.split(' ')
    return input
}

// https://stackoverflow.com/questions/53606337/check-if-array-contains-all-elements-of-another-array
let checker = (arr, target) => target.every(v => arr.includes(v))

// find corresponding promo value depending on user input.
// if not found, return false
// user can enter either first name, last name or full name
function findPromoName(input) {
    let promoNames = Object.keys(ENAPromoNames).map(name => name.split(' '))
    input = cleanInput(input)
    // TODO: check if multiple promo names have the same first name => eg: 'georges' is in 'georges clemenceau' and 'georges orwell'
    for (let i = 0; i < promoNames.length; i++) {
        if (checker(promoNames[i], input)) {
            return ENAPromoNames[Object.keys(ENAPromoNames)[i]]
        }
    }
    return false
}

async function getJORFSearchResult(year) {
    let url = `https://jorfsearch.steinertriples.ch/tag/eleve_ena=%22${year}%22?format=JSON`
    const res = await axios.get(url)
        .then(response => {
            return response.data
        })
    return res
}

function capitalizeFirstLetters(string) {
    try {
        return string.replace(/\b\w/g, l => l.toUpperCase())
    } catch (e) {
        // catching errors in case characters are not letters
        return false
    }
}

async function searchPersonOnJORF(personString) {
    return await axios.get(encodeURI(`https://jorfsearch.steinertriples.ch/name/${personString}?format=JSON`))
        .then(async res => {
            if (res.data?.length === 0) {
                return res
            }
            if (res.request.res.responseUrl) {
                return await axios.get(res.request.res.responseUrl.endsWith('?format=JSON') ? res.request.res.responseUrl : `${res.request.res.responseUrl}?format=JSON`)
            }
        })
}

function isPersonAlreadyFollowed(id, followedPeople) {
    return followedPeople.some(person => person.peopleId.equals(id))
}

module.exports = bot => async msg => {
    try {
        const chatId = msg.chat.id
        const text = `Entrez le nom de votre promo (ENA) et l'*intégralité de ses élèves* sera ajoutée à la liste de vos contacts.\n
⚠️ Attention, beaucoup de personnes seront ajoutées en même temps, *les retirer peut ensuite prendre du temps* ⚠️`
        const question = await bot.sendMessage(
            msg.chat.id,
            text,
            { 
                parse_mode: "Markdown",
                reply_markup: {
                    force_reply: true
                }
            }
        )
        let JORFSearchRes
        await bot.onReplyToMessage(chatId, question.message_id, async msg => {
            const yearString = findPromoName(msg.text)
            JORFSearchRes = await getJORFSearchResult(yearString)
            const promoName = Object.keys(ENAPromoNames).find(key => ENAPromoNames[key] === yearString)
            let text = `La promotion *${capitalizeFirstLetters(promoName)}* contient *${JORFSearchRes.length} élèves*:`
            if (JORFSearchRes.length > 0) {
                await sendLongText(bot, chatId, text, { parse_mode: "Markdown" })
            } else {
                return await bot.sendMessage(chatId, 'Promo introuvable', { parse_mode: "Markdown" })
            }
            // wait 2 seconds
            await new Promise(resolve => setTimeout(resolve, 2000))
            // sort JORFSearchRes by last name
            JORFSearchRes.sort((a, b) => {
                if (a.nom < b.nom) return -1
                if (a.nom > b.nom) return 1
                return 0
            })
            // send all contacts
            const contacts = JORFSearchRes.map(contact => {
                return `${contact.nom} ${contact.prenom}`
            })
            await sendLongText(
                bot,
                chatId,
                contacts.join('\n'),
                {reply_markup: {
                    force_reply: true
                }}
            )
            const followConfirmation = await bot.sendMessage(
                chatId,
                `Voulez-vous ajouter ces personnes à vos contacts ? (répondez *oui* ou *non*)\n\n⚠️ Attention : *les retirer peut ensuite prendre du temps*`,
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        force_reply: true
                    }
                }
            )
            await bot.onReplyToMessage(chatId, followConfirmation.message_id, async msg => {
                if (new RegExp(/oui/i).test(msg.text)) {
                    await bot.sendMessage(
                        chatId,
                        `Ajout en cours... Cela peut prendre plusieurs minutes. ⏰`
                    )
                    const tgUser = msg.from
                    let user = await User.firstOrCreate(tgUser, chatId)
                    for (let i = 0; i < JORFSearchRes.length; i++) {
                        const contact = JORFSearchRes[i]
                        console.log(`ENA - Searching for ${contact.nom} ${contact.prenom} on JORFSearch...`)
                        const search = await searchPersonOnJORF(`${contact.nom} ${contact.prenom}`)
                        if (search.data?.length) {
                            const people = await People.firstOrCreate({
                                nom: search.data[0].nom,
                                prenom: search.data[0].prenom,
                                JORFSearchData: search.data,
                            })
                            await people.save()
                            // only add to followedPeople if user is not already following this person
                            if (!isPersonAlreadyFollowed(people._id, user.followedPeople)) {
                                user.followedPeople.push({ peopleId: people._id, lastUdpate: Date.now() })
                            }
                        }
                    }
                    await user.save()
                    await bot.sendMessage(
                        chatId,
                        `Les *${JORFSearchRes.length} personnes* de la promo *${capitalizeFirstLetters(promoName)}* ont été ajoutées à vos contacts.`,
                        startKeyboard
                    )
                } else if (new RegExp(/non/i).test(msg.text)) {
                    await bot.sendMessage(
                        chatId,
                        `Ok, aucun ajout n'a été effectué. 👌`
                    )
                } else {
                    await bot.sendMessage(
                        chatId,
                        `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /ena.`,
                    )
                }
            })
        })
    } catch (error) {
        console.log(error)
    }
}
