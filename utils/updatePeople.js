require("dotenv").config()
const mongoose = require("mongoose")
const env = process.env
const config = require("../config")
const People = require('../models/People')
const axios = require("axios")

async function updatePeopleInDB() {
    const people = await People.find()
    // for loop that iterates each second
    for await (let person of people) {
        const JORFRes = await axios.get(`https://jorfsearch.steinertriples.ch/name/${encodeURI(`${person.prenom} ${person.nom}`)}?format=JSON`)
            .then(async res => {
                if (res.data?.length === 0) {
                    return res
                }
                if (res.request.res.responseUrl) {
                    let result = await axios.get(res.request.res.responseUrl.endsWith('?format=JSON') ? res.request.res.responseUrl : `${res.request.res.responseUrl}?format=JSON`)
                    return result
                }
            }
            )
        if (JORFRes?.data?.length === 0) {
            console.log(`${person.nom} ${person.prenom} is stored in db but was not found on JORFSearch`)
        } else {
            if (JSON.stringify(JORFRes.data) !== JSON.stringify(person.JORFSearchData)) {
                person.JORFSearchData = JORFRes.data
                await person.save()
                console.log(`${person.nom} ${person.prenom} was updated`)
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
    }
    return
}

mongoose
    .connect(env.MONGODB_URI, config.mongodb)
    .then(async () => {
        await updatePeopleInDB()
        process.exit(0)
    })
    .catch(err => {
        console.log(err)
    })