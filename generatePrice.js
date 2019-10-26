require('dotenv').config();

const Backpacktf = require('./backpacktf.js');
const bptf = new Backpacktf(process.env.BACKPACKTF_KEY, process.env.BACKPACKTF_TOKEN);

const bptfSearchRegex = /^(The\s|Strange\s|Non-Craftable\s\Genuine\s)?(Specialized\s|Professional\s)?(Killstreak\s)?(Australium\s)?/;

const urls = [
    "https://backpack.tf/classifieds?item=Lightning%20Lid&quality=6&tradable=1&craftable=1&australium=-1&killstreak_tier=0",
    "https://backpack.tf/classifieds?item=Croaking%20Hazard&quality=11&tradable=1&craftable=1&australium=-1&killstreak_tier=0",
    "https://backpack.tf/classifieds?item=Firefly&quality=6&tradable=1&craftable=1&australium=-1&killstreak_tier=0",
    "https://backpack.tf/classifieds?item=Festive%20Huntsman&quality=6&tradable=1&craftable=1&australium=-1&killstreak_tier=1",
    "https://backpack.tf/classifieds?item=Scattergun&quality=11&tradable=1&craftable=1&australium=-1&killstreak_tier=1"
];

Promise.all(
    urls.map(url => {
        return generatePrice(url).catch(null);
    })
).then(prices => {
    const priceFile = JSON.stringify(prices.filter(Boolean).reduce((acc, cur) => {
        const itemName = Object.keys(cur)[0];
        acc[itemName] = cur[itemName];
        return acc;
    }, {}));
    console.log(priceFile);
});


async function generatePrice(url) {
    const itemData = decodeURIComponent(url.split('?')[1]).split('&').reduce((acc, cur) => {
        const [field, property] = cur.split('=');
        acc[field] = property;
        return acc;
    }, {});

    const data = await bptf.searchClassifieds(itemData);
    const buyListings = data.buy.listings.filter(automaticFilter).filter(verifiedListing);
    const sellListings = data.sell.listings.filter(automaticFilter).filter(verifiedListing);
    const buyPrice = buyListings[0];
    const sellPrice = sellListings[0];
    if (!buyPrice || !sellPrice) { return; }
    const price = {
        [buyListings[0].item.name]: {
            sell: {
                metal: refToScrap(sellPrice.currencies.metal),
                keys: sellPrice.currencies.keys || 0
            },
            buy: {
                metal: refToScrap(buyPrice.currencies.metal),
                keys: buyPrice.currencies.keys || 0
            },
            stock: 1,
            isCurrency: false,
            craftable: itemData.craftable === '1' ? true : false,
            filters: {
                ...itemData
            },
            active: true
        }
    };
    delete price[buyListings[0].item.name].filters.item;
    delete price[buyListings[0].item.name].filters.tradable;
    return price;
}

function refToScrap(ref) {
    const wholeRef = Math.trunc(ref);
    return wholeRef * 9 + Math.round((ref - wholeRef) / .11);
}

function verifiedListing(listing, i, originalListing) {
    const occurences = originalListing.filter(buy => {
        if (listing.currencies.keys === buy.currencies.keys && listing.currencies.metal === buy.currencies.metal) {
            return true;
        }
    });
    return occurences.length >= 3;
}

function automaticFilter(listing) {
    if (listing.automatic && listing.automatic === 1 && listing.steamid !== process.env.STEAMID) {
        return true;
    }
    return false;
}