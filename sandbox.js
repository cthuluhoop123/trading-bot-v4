require('dotenv').config()

const fs = require('fs')

const Backpacktf = require('./backpacktf.js')
const backpacktf = new Backpacktf(process.env.BACKPACKTF_KEY, process.env.BACKPACKTF_TOKEN)

backpacktf.getListings()
        .then(({ listings }) => {
            backpacktf.deleteListings(listings.map(u => u.id))
        })

function scrapToRef(scrap) {
    return Math.floor(scrap / 9 * 100) / 100
}

function refToScrap(ref) {
    const wholeRef = Math.trunc(ref)
    return wholeRef * 9 + Math.round((ref - wholeRef) / .11)
}

function roundRef(ref) {
    const scrap = refToScrap(ref)
    return scrapToRef(scrap)
}