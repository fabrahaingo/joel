function convertToFrenchDate(date) {
    let options = { year: 'numeric', month: 'long', day: 'numeric' }
    date = new Date(date)
    return date.toLocaleDateString("fr-FR", options)
}

function addTypeOrdre(elem, message) {
    switch (elem.type_ordre) {
        case "nomination":
            message += `📝 A été _nommé${elem.sexe=='F'?'e':''}_ à:\n`
            break
        case "réintégration":
            message += `📝 A été _réintégré${elem.sexe=='F'?'e':''}_ à:\n`
            break
        case "cessation de fonction":
            message += `📝 A _cessé ses fonctions_ à:\n`
            break
        case "affectation":
            message += `📝 A été _affecté${elem.sexe=='F'?'e':''}_ à:\n`
            break
        case "délégation de signature":
            message += `📝 A reçu une _délégation de signature_ à:\n`
            break
        case "promotion":
            message += `📝 A été _promu${elem.sexe=='F'?'e':''}_:\n`
            break
        case "admission":
            message += `📝 A été _admis${elem.sexe=='F'?'e':''}_ \n`
            break
        case "inscription":
            message += `📝 A été _inscrit${elem.sexe=='F'?'e':''}_ à:\n`
            break
		case "désignation":
			message += `📝 A été _désigné${elem.sexe=='F'?'e':''}_ à:\n`
            break
		case "détachement":
			message += `📝 A été _détaché${elem.sexe=='F'?'e':''}_ à:\n`
            break
		case "radiation":
			message += `📝 A été _radié${elem.sexe=='F'?'e':''}_ à:\n`
            break
		case "renouvellement":
			message += `📝 A été _renouvelé${elem.sexe=='F'?'e':''}_ à:\n`
            break
		case "reconduction":
			message += `📝 A été _reconduit${elem.sexe=='F'?'e':''}_ à:\n`
            break
		case "élection":
			message += `📝 A été _élu${elem.sexe=='F'?'e':''}_ à:\n`
           	break
        default:
            message += `📝 A été _${elem.type_ordre}_ à:\n`
    }
    return message
}

function addPoste(elem, message) {
    if (elem.organisations && elem.organisations[0]?.nom) {
        message += `*👉 ${elem.organisations[0].nom}*\n`
    } else if (elem.ministre) {
        message += `*👉 ${elem.ministre}*\n`
    } else if (elem.inspecteur_general) {
        message += `*👉 Inspecteur général des ${elem.inspecteur_general}*\n`
    } else if (elem.grade) {
        message += `👉 au grade de *${elem.grade}*`
			if (elem.ordre_merite){
			message += ` de l'Ordre national du mérite`
			}	else if (elem.legion_honneur){
			message += ` de la Légion d'honneur`
			}
		message += `${elem.nomme_par ? ` par le _${elem.nomme_par}_` : ''}\n`
    } else if (elem.autorite_delegation) {
        message += `👉 par le _${elem.autorite_delegation}_\n`
    } else {
        message += `👉 [Voir sur legifrance](https://www.legifrance.gouv.fr/jorf/id/${elem.source_id})\n`
    }
    return message
}

function addLinkJO(elem, message) {
    if (elem.date_debut) {
        message += `🔗 _Lien JO_:  [cliquez ici](https://www.legifrance.gouv.fr/jorf/id/${elem.source_id})\n`
    }
    return message
}

function addPublishDate(elem, message) {
    if (elem.source_date) {
        message += `🗓 _Publié le_:  ${convertToFrenchDate(elem.source_date)}\n`
    }
    return message
}

function formatSearchResult(result, options) {
    let message = ''
    let defaultPart = 'Est-ce bien la personne que vous souhaitez suivre ?\n\n*Répondez "oui" ou "non"*\n\n'
    if (options?.isConfirmation) {
        if (result.length === 1)
            message += `Voici la dernière information que nous avons sur *${result[0].prenom} ${result[0].nom}*.\n${defaultPart}`
        else
            message += `Voici les ${result.length} dernières informations que nous avons sur *${result[0].prenom} ${result[0].nom}*.\n${defaultPart}`

    } else if (!options?.isListing) {
        message += `Voici la liste des postes connus pour ${result[0].prenom} ${result[0].nom}:\n\n`
    }
    for (let elem of result) {
        message = addTypeOrdre(elem, message)
        message = addPoste(elem, message)
        message = addPublishDate(elem, message)
        message = addLinkJO(elem, message)
        message += '\n'
    }
    return message
}

module.exports = { formatSearchResult, convertToFrenchDate }
