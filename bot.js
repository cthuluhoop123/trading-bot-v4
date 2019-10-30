require('dotenv').config();

const fs = require('fs');
const { decache } = require('./util.js');

const chalk = require('chalk');
const warn = chalk.keyword('orange');
const info = chalk.keyword('blue');

const SteamUser = require('steam-user');
const client = new SteamUser();
const SteamCommunity = require('steamcommunity');
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamTotp = require('steam-totp');
const TeamFortress2 = require('tf2');
const tf2 = new TeamFortress2(client);

const { admins, ignoreUndercut, steamGroup } = require('./config.js');

const Backpacktf = require('./backpacktf.js');
const backpacktf = new Backpacktf(process.env.BACKPACKTF_KEY, process.env.BACKPACKTF_TOKEN);

const request = require('superagent');

let history = require('./history.json');
let prices = require('./prices.json');

const community = new SteamCommunity();

const manager = new TradeOfferManager({
    steam: client,
    community: community,
    language: 'en'
});

const logOnOptions = {
    accountName: process.env.STEAM_USERNAME,
    password: process.env.PASSWORD,
    twoFactorCode: SteamTotp.generateAuthCode(process.env.SHARED_SECRET)
};

const bptfListingRegex = /^(The\s|Strange\s|Non-Craftable\s|Genuine\s)/;
const bptfSearchRegex = /^(The\s|Strange\s|Non-Craftable\s\Genuine\s)?(Specialized\s|Professional\s)?(Killstreak\s)?(Australium\s)?/;

const tradeQueue = [];
const finalizeQueue = [];


let inventoryCache;
let bumpListingTimeout;
let keyPrice;

client.logOn(logOnOptions);

tf2.on('backpackLoaded', async () => {
    await craftChange().catch(err => console.error('Error crafting change in backpackLoaded', err));
    tf2.sortBackpack(4);
});

tf2.on('itemRemoved', async () => {
    await craftChange().catch(err => console.error('Error crafting change in itemRemoved', err));
    tf2.sortBackpack(4);
});

tf2.on('itemAcquired', async () => {
    await craftChange().catch(err => console.error('Error crafting change in itemAcquired', err));
    tf2.sortBackpack(4);
});

tf2.on('craftingComplete', (recipe, itemsGained) => {
    console.log(info('Crafted some change...'));
});

client.on('loggedOn', async () => {
    console.log(info('Logged in!'));
    client.setPersona(SteamUser.Steam.EPersonaState.Online);
    client.gamesPlayed(440);
});

community.on('debug', console.log);

community.on('sessionExpired', async () => {
    if (!client.steamID) {
        client.logOn();
    } else {
        client.webLogOn();
    }
});

client.on('webSession', (sessionID, cookies) => {
    manager.setCookies(cookies, async err => {
        if (err) {
            console.error(err);
            process.exit(1);
        }
        console.log(info('Got API key'));

        await getInventory().catch(err => console.error('Could not get inventory in webSession event', err));

        community.setCookies(cookies);


        client.setPersona(SteamUser.Steam.EPersonaState.Online);
        client.gamesPlayed(440);

        const acceptQueue = tradeQueue.filter(trade => trade.action === 'accept');
        const declineQueue = tradeQueue.filter(trade => trade.action === 'decline');

        for (const trade of acceptQueue) {
            try {
                await acceptOffer(trade.offer);
                tradeQueue.splice(tradeQueue.indexOf(trade), 1);
            } catch (err) {
                console.error('Error accepting trade offer from tradeQueue', err);
            }
        }

        for (const trade of declineQueue) {
            try {
                await declineOffer(trade.offer, trade.reason);
                tradeQueue.splice(tradeQueue.indexOf(trade), 1);
            } catch (err) {
                console.error('Error declining trade offer from tradeQueue', err);
            }
        }

        for (const offer of finalizeQueue) {
            try {
                await finalizeOffer(offer);
                finalizeOffer.splice(finalizeOffer.indexOf(offer), 1);
            } catch (err) { console.error('Error finalizing trade from finalizeQueue.', err); }
        }

        if (!bumpListingTimeout) {
            bumpListings();
        }
    });
});

client.on('friendRelationship', function (steamID, relationship) {
    const steamID64 = steamID.getSteamID64();
    if (relationship === SteamUser.EFriendRelationship.Friend) {
        console.log('I am now friends with ' + steamID64);
        if (steamGroup) {
            community.inviteUserToGroup(steamID64, steamGroup);
        }
    }
    if (relationship === SteamUser.EFriendRelationship.RequestRecipient) {
        console.log(steamID64 + ' added me');
        addFriend(steamID64).catch(() => { });
    }
});


manager.on('newOffer', async offer => {

    if (admins.includes(offer.partner.getSteamID64())) {
        acceptOffer(offer);
        return;
    }

    if (offer.isGlitched()) {
        declineOffer(offer, 'Glitched offer.');
        return;
    }

    try {
        const inventory = await getInventory();
        const overstock = offer.itemsToReceive.some(receivingItem => {
            if (!prices[receivingItem.market_hash_name]) { return false; }
            const amountInInventory = inventory.filter(item => item.market_hash_name === receivingItem.market_hash_name && craftable(item) === craftable(receivingItem)).length;
            const amountReceiving = offer.itemsToReceive.filter(item => item.market_hash_name === receivingItem.market_hash_name && craftable(item) === craftable(receivingItem)).length;
            if (amountInInventory + amountReceiving > prices[receivingItem.market_hash_name].stock) {
                return true;
            }
        });
        if (overstock) {
            declineOffer(offer, 'Overstocked');
            return;
        }
    } catch (e) {
        console.error(e);
    }

    const itemsToGiveValue = calculatePrice(offer.itemsToGive, 'sell');
    const itemsToReceiveValue = calculatePrice(offer.itemsToReceive, 'buy');

    if (itemsToReceiveValue.keys >= itemsToGiveValue.keys && itemsToReceiveValue.metal >= itemsToGiveValue.metal) {
        const partnerId = offer.partner.getSteamID64();
        const reputation = await backpacktf.checkReputation(partnerId);
        if (reputation.users[partnerId].bans && reputation.users[partnerId].bans.steamrep_scammer) {
            await declineOffer(offer, `User is marked as scammer on steamrep`);
        } else {
            await finalizeOffer(offer).catch(err => {
                if (err.message !== 'Not Logged In') {
                    console.error(err);
                }
            });
        }
    } else {
        await declineOffer(offer, `Took too much/didnt pay enough. ID: ${offer.id} | Giving: ${itemsToGiveValue.keys} keys ${scrapToRef(itemsToGiveValue.metal)} ref | Receiving: ${itemsToReceiveValue.keys} keys ${scrapToRef(itemsToReceiveValue.metal)} ref`);
    }
});

function finalizeOffer(offer) {
    return new Promise((resolve, reject) => {
        offer.getUserDetails((err, me, them) => {
            if (err.message === 'Not Logged In') {
                finalizeQueue.push(offer);
                reject(err);
                return;
            }
            if (them.escrowDays > 7) {
                declineOffer(offer, 'Trade would be escrowed for more than 7 days.').catch(err => console.error('Could not deny escrowed offer.', err));
                return;
            }
            acceptOffer(offer).catch(err => {
                if (err.message !== 'Not Logged In') {
                    console.error('Could not accept offer in finalizeOffer', err);
                }
            });
        });
    });
}

function acceptOffer(offer) {
    return new Promise((resolve, reject) => {
        offer.accept((err, status) => {
            if (err) {
                if (err.message === 'Not Logged In') {
                    console.log(warn('Tried to accept trade but not logged in...Pushing to trade queue.'));
                    tradeQueue.push({ action: 'accept', offer });
                }
                reject(err);
                return;
            }
            console.log(info('Accepted an offer.'));
            const itemsImGiving = offer.itemsToGive.map(give => give.id);
            inventoryCache = inventoryCache.filter(item => {
                return !itemsImGiving.includes(item.id);
            }).concat(offer.itemsToReceive);

            acceptConfirmation(offer);
            resolve(status);
        })
    })
}

function declineOffer(offer, reason) {
    return new Promise((resolve, reject) => {
        offer.decline(err => {
            if (err) {
                if (err.message === 'Not Logged In') {
                    tradeQueue.push({ action: 'decline', reason, offer });
                }
                reject(err);
                return;
            }
            console.log(warn(`Denied an offer.`, reason));

            client.getPersonas([offer.partner], personas => {
                request
                    .post(`http://localhost:${process.env.WEBHOOKPORT}/tradeDeclined`)
                    .send({
                        id: offer.id,
                        partner: offer.partner.getSteamID64(),
                        itemsToGive: offer.itemsToGive,
                        itemsToReceive: offer.itemsToReceive,
                        persona: personas[offer.partner.getSteamID64()],
                        reason
                    })
                    .catch(err => console.error(err));
            });
            resolve(true);
        });
    });
}

function craftable(item) {
    var descriptionLength = item.descriptions.length;
    for (i = 0; i < descriptionLength; i++) {
        if (item.descriptions[i].value === '( Not Usable in Crafting )') {
            return false;
        }
    }
    return true;
}

function calculatePrice(items, intent) {

    const shit = items.reduce((accumulator, currentValue) => {

        if (intent === 'buy' && (!prices[currentValue.market_hash_name] || prices[currentValue.market_hash_name].craftable !== craftable(currentValue))) {
            return accumulator;
        }

        if (intent === 'sell' && (!prices[currentValue.market_hash_name] || prices[currentValue.market_hash_name].craftable !== craftable(currentValue))) {
            accumulator.metal = accumulator.metal + 9999;
            accumulator.keys = accumulator.keys + 9999;
            return accumulator;
        }

        accumulator.metal = accumulator.metal + prices[currentValue.market_hash_name][intent].metal;
        accumulator.keys = accumulator.keys + prices[currentValue.market_hash_name][intent].keys;

        return accumulator;

    }, { keys: 0, metal: 0 });
    return shit;

}

function getInventory(fresh = false) {
    return new Promise((resolve, reject) => {

        if (inventoryCache && !fresh) {
            resolve(inventoryCache);
            return;
        }

        manager.getInventoryContents(440, 2, true, (err, inventory) => {
            if (err) {
                if (inventoryCache) {
                    resolve(inventoryCache);
                    return;
                }
                reject(err);
            }
            inventoryCache = inventory;
            resolve(inventoryCache);
        });
    });
}

async function undercutBackpacktf(item) {
    decache('./prices.json');
    prices = require('./prices.json');

    try {
        const currencies = await backpacktf.iGetCurrencies();
        keyPrice = currencies.response.currencies.keys.price.value;
    } catch (err) {
        console.error('Could not get key price in undercutBackpacktf()', err);
    }

    const search = Object.assign({
        item: item.replace(bptfSearchRegex, ''),
        fold: 1
    }, prices[item].filters);

    const bptfListings = await backpacktf.searchClassifieds(search);
    const buyListings = bptfListings.buy.listings.filter(automaticFilter).map(populateCurrency).filter(verifiedListing).sort((a, b) => {
        const key = refToScrap(keyPrice);
        const aValue = key * a.currencies.keys + a.currencies.metal;
        const bValue = key * b.currencies.keys + b.currencies.metal;
        return bValue - aValue;
    });
    const sellListings = bptfListings.sell.listings.filter(automaticFilter).map(populateCurrency).filter(verifiedListing).sort((a, b) => {
        const key = refToScrap(keyPrice);
        const aValue = key * a.currencies.keys + a.currencies.metal;
        const bValue = key * b.currencies.keys + b.currencies.metal;
        return aValue - bValue;
    });;

    if (sellListings.length === 0 || buyListings.length === 0) { return; }

    if (sellListings[0].currencies.keys > buyListings[0].currencies.keys || sellListings[0].currencies.keys === buyListings[0].currencies.keys && sellListings[0].currencies.metal >= buyListings[0].currencies.metal) {

        prices[item].active = true;

        const highestBuyPrice = { keys: buyListings[0].currencies.keys, metal: refToScrap(buyListings[0].currencies.metal) };
        const lowestSellPrice = { keys: sellListings[0].currencies.keys, metal: refToScrap(sellListings[0].currencies.metal) };

        const contestingBuyBots = buyListings.map(getTopListings);
        const contestingSellBots = sellListings.map(getTopListings);

        const topBuyList = contestingBuyBots.filter(filterTopListings);
        const topSellList = contestingSellBots.filter(filterTopListings);

        if (keyPrice && (lowestSellPrice.keys > highestBuyPrice.keys || lowestSellPrice.keys === highestBuyPrice.keys && lowestSellPrice.metal - highestBuyPrice.metal > 2)) {

            if (topBuyList.length >= 5) {
                const targetPrice = refToScrap(keyPrice) * highestBuyPrice.keys + highestBuyPrice.metal;
                const overcutPrice = scrapToRef(targetPrice + 1);
                const overcutKeys = overcutPrice / keyPrice;
                const overcutMetal = refToScrap(roundRef((overcutKeys - Math.trunc(overcutKeys)) * keyPrice));

                prices[item].buy.metal = overcutMetal;
                prices[item].buy.keys = Math.trunc(overcutKeys);
            } else {
                prices[item].buy.metal = highestBuyPrice.metal;
                prices[item].buy.keys = highestBuyPrice.keys;
            }
            if (topSellList.length >= 5) {
                const targetPrice = refToScrap(keyPrice) * lowestSellPrice.keys + lowestSellPrice.metal;
                const undercutPrice = scrapToRef(targetPrice - 1);
                const undercutKeys = undercutPrice / keyPrice;
                const undercutMetal = refToScrap(roundRef((undercutKeys - Math.trunc(undercutKeys)) * keyPrice));

                prices[item].sell.metal = undercutMetal;
                prices[item].sell.keys = Math.trunc(undercutKeys);
            } else {
                prices[item].sell.metal = lowestSellPrice.metal;
                prices[item].sell.keys = lowestSellPrice.keys;
            }


        } else {

            prices[item].sell.metal = lowestSellPrice.metal;
            prices[item].sell.keys = lowestSellPrice.keys;

            prices[item].buy.metal = highestBuyPrice.metal;
            prices[item].buy.keys = highestBuyPrice.keys;
        }

    } else {
        prices[item].active = false;
    }
    try {
        fs.writeFileSync('./prices.json', JSON.stringify(prices));
    } catch (err) {
        console.error('Could not save prices.json after undercutting', err);
    }
}

async function bumpListings() {
    console.log(info('Bumping listings...'));

    decache('./prices.json');
    prices = require('./prices.json');

    let inventory;
    let backpacktfListings;

    try {
        inventory = await getInventory(true);
    } catch (err) {
        console.error('Error getting inventory in bumpListing()', err);
    }

    try {
        await backpacktf.refreshBackpack();
    } catch (err) {
        console.error('Could not refresh backpack.tf backpack in bumpListings()', err);
    }

    try {
        backpacktfListings = await backpacktf.getListings({
            intent: 0,
            inactive: 1
        });
    } catch (err) {
        console.error('Unable to get backpack listings during bumpListings()', err);
    }

    const pricedItems = getNonCurrencyItems();

    for (let item of pricedItems) {
        await undercutBackpacktf(item).catch(err => console.error('Could not undercut during bumpListings()', err));
        const inInventory = inventory.filter(inventoryItem => inventoryItem.market_hash_name === item && craftable(inventoryItem) === prices[item].craftable).length;

        try {
            const selling = inventory.find(inventoryItem => item === inventoryItem.market_hash_name && prices[item].craftable === craftable(inventoryItem));
            if (selling) {
                await backpacktf.createListings([
                    {
                        intent: 1,
                        id: selling.id,
                        details: `⚡[⇄] 24/7 TRADING BOT! // Send me a trade offer!⚡ Selling for: ${prices[item].sell.keys} key(s) + ${scrapToRef(prices[item].sell.metal)} ref!`,
                        currencies: {
                            keys: prices[item].sell.keys,
                            metal: scrapToRef(prices[item].sell.metal)
                        }
                    }
                ]);
            }
        } catch (err) {
            console.error('Could not create sell listing in bumpListings()', err);
        }

        if (!prices[item].active || inInventory >= prices[item].stock) {
            const itemListing = backpacktfListings.listings.find(listing => listing.item.name === item);
            if (itemListing) {
                try {
                    await backpacktf.deleteListings([itemListing.id]);
                } catch (err) {
                    console.error('Error when deleting listings in bumpListings()', err);
                }
            }
        } else {
            // const bptfFilter = Object.assign(prices[item].filters, { craftable: prices[item].filters.craftable === -1 ? 0 : 1 })
            // try {
            //     await backpacktf.createListings([
            //         {
            //             intent: 0,
            //             item: Object.assign({
            //                 item_name: item.replace(bptfListingRegex, ''),
            //             }, bptfFilter),
            //             details: `⚡[⇄] 24/7 TRADING BOT! // Send me a trade offer!⚡ Buying for: ${prices[item].buy.keys} key(s) + ${scrapToRef(prices[item].buy.metal)} ref! Stock: ${inInventory}/${prices[item].stock}!`,
            //             currencies: {
            //                 keys: prices[item].buy.keys,
            //                 metal: scrapToRef(prices[item].buy.metal)
            //             }
            //         }
            //     ])
            // } catch (err) {
            //     console.error('Error when creating buy listing in bumpListings()', err)
            // }
        }

        await sleep(500);
    }


    console.log(info('Bumped listings.'));
    bumpListingTimeout = setTimeout(bumpListings, 1000 * 60 * 30);
}

function getNonCurrencyItems() {
    return Object.keys(prices).filter(item => {
        return prices[item].isCurrency === false;
    });
}

function sleep(time = 1000) {
    return new Promise(resolve => {
        setTimeout(resolve, time);
    });
}

function scrapToRef(scrap) {
    return Math.floor(scrap / 9 * 100) / 100;
}

function refToScrap(ref) {
    const wholeRef = Math.trunc(ref);
    return wholeRef * 9 + Math.round((ref - wholeRef) / .11);
}

function roundRef(ref) {
    const scrap = refToScrap(ref);
    return scrapToRef(scrap);
}

function automaticFilter(listing) {
    if (listing.automatic && listing.automatic === 1 && listing.steamid !== process.env.STEAMID && !ignoreUndercut.includes(listing.steamid)) {
        return true;
    }
    return false;
}

function populateCurrency(listing) {
    if (!listing.currencies.keys) {
        listing.currencies.keys = 0;
    }
    if (!listing.currencies.metal) {
        listing.currencies.metal = 0;
    }
    return listing;
}

function getTopListings(listing) {
    return { keys: listing.currencies.keys, metal: listing.currencies.metal };
}

function filterTopListings(bots, i, contesting) {
    if (bots.keys === contesting[0].keys && bots.metal === contesting[0].metal) {
        return true;
    }
}

function verifiedListing(listing, i, originalListing) {
    const occurences = originalListing.filter(buy => {
        if (listing.currencies.keys === buy.currencies.keys && listing.currencies.metal === buy.currencies.metal) {
            return true;
        }
    });
    return occurences.length >= 3;
}

async function acceptConfirmation(offer) {
    community.acceptConfirmationForObject(process.env.IDENTITY_SECRET, offer.id, err => {
        if (err) {
            if (err.message === 'Could not act on confirmation') {
                if (offer.retries && offer.retries > 2) {
                    return;
                }
                offer.retries
                    ? offer.retries = offer.retries + 1
                    : offer.retries = 1;
                setTimeout(acceptConfirmation, 1500, offer);
                return;
            }
            console.error(err.message);
            return;
        }

        decache('./history.json');
        history = require('./history.json');

        offer.itemsToGive.forEach(item => {
            const itemInHistory = history.trades.find(historyItem => historyItem.market_hash_name === item.market_hash_name);
            if (itemInHistory && prices[item.market_hash_name] && !prices[item.market_hash_name].isCurrency) {
                history.profit.keys = history.profit.keys + (prices[item.market_hash_name].sell.keys - itemInHistory.buy.keys);
                history.profit.metal = history.profit.metal + (prices[item.market_hash_name].sell.metal - itemInHistory.buy.metal);
                history.trades = history.trades.filter(trade => trade !== itemInHistory);
            }
        });

        offer.itemsToReceive.forEach(async (item, i, receiving) => {
            if (prices[item.market_hash_name] && !prices[item.market_hash_name].isCurrency) {
                history.trades.push({
                    market_hash_name: item.market_hash_name,
                    buy: prices[item.market_hash_name].buy
                });

                try {
                    const inventory = await getInventory();
                    const amountInInventory = inventory.filter(cache => cache.market_hash_name === item.market_hash_name && craftable(cache) === craftable(item)).length;
                    if (amountInInventory >= prices[item.market_hash_name].stock) {
                        const search = Object.assign({
                            item: item.market_hash_name.replace(bptfSearchRegex, ''),
                            fold: 1,
                            steamid: process.env.STEAMID,
                            intent: 'buy'
                        }, prices[item.market_hash_name].filters);

                        const { buy: buyListings } = await backpacktf.searchClassifieds(search);
                        if (buyListings.listings.length) {
                            await backpacktf.deleteListings([buyListings.listings[0].id]).catch(err => console.error('Error deleting listing:', err));
                        }
                    }
                } catch (err) {
                    console.error('Could not get inventory to delete potentially overstocked items', err);
                }

            }
        })

        fs.writeFileSync('./history.json', JSON.stringify(history));

        if (steamGroup) { addFriend(offer.partner.getSteamID64()).catch(() => { }); }

        client.getPersonas([offer.partner], personas => {
            request
                .post(`http://localhost:${process.env.WEBHOOKPORT}/tradeAccepted`)
                .send({
                    id: offer.id,
                    partner: offer.partner.getSteamID64(),
                    itemsToGive: offer.itemsToGive,
                    itemsToReceive: offer.itemsToReceive,
                    persona: personas[offer.partner.getSteamID64()]
                }).catch(err => console.error(err));
        });


    });
}

function addFriend(steamID64) {
    return new Promise((resolve, reject) => {
        client.addFriend(steamID64, function (err) {
            if (err) {
                reject(err);
                return;
            }
            const randomUserToUnfriend = Object.keys(client.myFriends).filter(id => !admins.includes(id) && steamID64 !== id);
            client.removeFriend(randomUserToUnfriend[0]);
            resolve();
        });
    });
}

async function craftChange() {
    if (tf2.backpack === undefined) { return; }

    const refs = tf2.backpack.filter(item => item.defIndex === 5002);
    const recs = tf2.backpack.filter(item => item.defIndex === 5001);
    const scraps = tf2.backpack.filter(item => item.defIndex === 5000);

    if (recs.length < 6 && refs.length > 0) {
        tf2.craft([refs[0].id]);
    }

    if (scraps.length < 6 && recs.length > 0) {
        tf2.craft([recs[0].id]);
    }
}

backpacktf.startHeartbeat();
