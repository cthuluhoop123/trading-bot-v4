require('dotenv').config()

const Backpacktf = require('./backpacktf.js')
const backpacktf = new Backpacktf(process.env.BACKPACKTF_KEY, process.env.BACKPACKTF_TOKEN)

backpacktf.getListings()
    .then(bp => {
        backpacktf.deleteListings(bp.listings.map(listing => listing.id))
            .then(console.log)
            .catch(console.error)
    })