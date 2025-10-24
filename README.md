[![TypeScript](https://badges.frapsoft.com/typescript/code/typescript.svg?v=101)](https://github.com/microsoft/TypeScript)
[![ESLint](https://github.com/DanyPM/joel_fork/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/fabrahaingo/joel/actions/workflows/main.yml)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
<br />
[![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
<br />
[![GitHub contributors](https://img.shields.io/github/contributors-anon/fabrahaingo/joel)](https://github.com/fabrahaingo/joel/graphs/contributors)
[![GitHub last commit](https://img.shields.io/github/last-commit/fabrahaingo/joel)](https://github.com/fabrahaingo/joel/commits/main/)
<br />
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<!-- PROJECT LOGO -->
<br />
<p align="center">
  <a href="./img/logo.png">
    <img src="img/logo.png" alt="Logo" width="100" height="100">
  </a>
  <h3 align="center">Restez informé·e des nominations au JO de votre réseau, où que vous chattiez 💬</h3>
</p>

<!-- TABLE OF CONTENTS -->
<details open="open">
  <summary>Table des matières</summary>
  <ol>
    <li>
      <a href="#about-the-project">A propos de ce projet</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Démarrer</a>
      <ul>
        <li><a href="#prérequis">Prérequis</a></li>
        <li><a href="#installation">Installation</a></li>
      	<li><a href="#utilisation">Utilisation</a></li>
	  </ul>
    </li>
    <li><a href="#contribuer">Contribuer</a></li>
	<li><a href="#bug"> Bug </a></li>
	<li><a href="#confidentialité"> Confidentialité </a></li>
    <li><a href="#contact">Contact</a></li>
    <!-- <li><a href="#acknowledgements">Acknowledgements</a></li> -->
  </ol>
</details>

## A propos de ce projet

On en avait marre de passer à côté de certaines nominations au Journal officiel de nos amis, collègues et organisations favorites.
</br></br>

Du coup, on a développé JOEL, un compagnon de veille qui nous chuchote les nominations importantes directement là où nous discutons déjà 👇
</br></br>

En effet, à l’heure actuelle, la version électronique du JO ne permet pas de faire une veille personnalisée des nominations. 🤷‍♂️
</br></br>
On a donc commencer par un bot Télégram pour être tenus au courant quotidiennement des mentions au JO des personnes qu’on voulait suivre.
</br>

EL parle désormais couramment **Telegram**, **WhatsApp** et **Matrix**, et son accent s’adapte à toute autre messagerie grâce à une interface d’intégration unique. Si votre équipe traîne ailleurs (Signal, Mattermost, IRC, tam-tam codé…), il suffit de brancher un nouveau connecteur et JOEL débarque !
</br>

JOEL c’est aussi:

<li> ⌨️ Une solution 100% open source</li>
<li> 💸 Un outil d’intérêt général sans but lucratif </li>
<li>🛡 Vos données sont anonymisées et ne sont pas réutilisées </li>
<li>🧩 Un nouvel élément de transparence et d’accessibilité du JO, dans la logique initiée par l’outil Jorfsearch de <a href="https://github.com/nathanncohen">Nathann Cohen</a> sur lequel est construit JOEL </li>
</br> 🤔 Et pourquoi « JOEL »? 
En hommage au <a href="https://fr.wikipedia.org/wiki/Fichier:Publicit%C3%A9_3615_JOEL.png">3615 JOEL</a>, qui permettait de consulter le <b>J</b>ournal <b>O</b>fficiel <b>EL</b>ectronique sur Minitel 😉 </br>

## Built With

JOEL se base sur l'outil l'outil <a href="https://jorfsearch.steinertriples.ch/">JORFSearch</a> développé par <a href="https://github.com/nathanncohen">Nathann Cohen</a> et permettant de faire de chercher les nominations au JO.

## Démarrer

### Prérequis

JOEL requiert d'avoir téléchargé au moins une des applications compatibles (Telegram, WhatsApp, Matrix… ou la messagerie que vous brancherez vous-même 😎).

### Installation

- Telegram : <a href="https://t.me/JOEL_hellofabot">Par içi !</a>
- WhatsApp : <a href="https://wa.me/33769441915?text=Bonjour%20JOEL%20!">Par là !</a>
- Matrix : <a href="https://matrix.to/#/@joel_bot:matrix.org">Ici encore !</a>

### Utilisation

#### Rechercher une personne

Pour rechercher une personne, vous pouvez cliquer sur le bouton "🔍 Rechercher" qui vous renverra sa dernière nomination au JO.

<p align="center">
  <a href="./img/tuto/search.png">
    <img src="img/tuto/search.png" alt="Logo" width=40% height=40%>
  </a>
</p>

Vous avez repéré une personne à ne pas lâcher des yeux ? Cliquez sur 🏃‍♀️ et laissez-vous guider. Vous pouvez :

- 🧑 Ajouter une personne individuellement (prénom + nom)
- 🎓 Importer toute une promotion ENA/INSP en un clin d'œil
- 📰 Coller un extrait du JO (JORF) pour extraire automatiquement les noms à suivre

#### Suivre des organisations et des fonctions

Les nominations ne concernent pas que des personnes :

- 🏢 Ajoutez des organisations entières pour être alerté quand elles bougent: Conseil d'Etat, Commission parlementaires, ANR ...
- 🪑 Suivez des intitulés de postes ou de fonctions pour traquer les nouveaux arrivants: Ambassadeurs, (sous-)-Préfets, Juges ...

## Fonctionnalités clés

- 🔔 Notifications quotidiennes ou à la demande selon votre canal favori (pour prouver à votre hiérarchie que vous étiez au courant avant tout le monde)
- 🗂 Gestion multi-listes pour séparer vos veilles (par équipe, par sujet, par curiosité malsaine)
- 🛠 Interface d’intégration pour brancher rapidement une nouvelle messagerie ou un workflow interne

## Bug

En cas de bug, contactez hellofabien@pm.me en mentionnant votre identifiant personnel (obtenu en cliquant sur le bouton "🐞")

## Confidentialité

JOEL ne cherchera jamais à vous identifier. Vos données sont anonymisées et ne seront jamais réutilisées. 🛡

## Contribuer

Toute contribution sera **grandement appréciée** 🤗

1. Forker le projet
2. Créer une branche feature ('git checkout -b feature/AmazingFeature')
3. Commiter les changement ('git commit -m 'Add some AmazingFeature')
4. Pusher dans la branche ('git push origin feature/AmazingFeature')
5. Ouvrir un Pull Request

## Contact

<a href="https://www.linkedin.com/in/fabien-rahaingomanana/">Fabien RAHAINGOMANANA</a>

<a href="https://www.linkedin.com/in/philemon-perrot/">Philémon PERROT</a>

<a href="https://dany.mestas.dev/">Dany MESTAS</a>

## License

Ce projet est sous licence MIT.
