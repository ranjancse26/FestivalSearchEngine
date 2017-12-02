const consts = require('./consts');
const use = require('./use');

exports.events = function(req, res) {
    log.debug("request url", req.url);
    log.debug("request params", req.params);
    let artist = req.params.artist;
    let location = req.params.location;
    res.type('json');

    if (artist == undefined && location == undefined) {
        log.error("no_params_provided");
        res.status(404).end(JSON.stringify({no_params_provided: true}));
    }
    else {
        artist = artist != undefined ? use.dia(artist).toLowerCase() : undefined;
        location = location != undefined ? use.dia(location).toLowerCase() : undefined;

        (function() {
            if (artist != undefined) {
                return spotifyApi.clientCredentialsGrant()
                .then(data => {
                    spotifyApi.setAccessToken(data.body['access_token']);
                    return spotifyApi.searchArtists(artist);
                })
                .then(data => {
                    log.debug(spotifyApi.getAccessToken());
        
                    if (data.body.artists.total === 0) {
                        return new Promise((resolve, reject) => {
                            reject(true);
                        });
                    }
                    else {
                        const spotify_artist = data.body.artists.items[0];
                        artist = spotify_artist.name.toLowerCase();
                        log.debug(spotify_artist);
                    }
                });
            }
            else {
                return new Promise((resolve, reject) => {
                    resolve();
                });
            }
        })()
        .then(() => {
            // First get request to obtain pages number of eventful data
            return axios.get(events_search_eventful, {
                params: {
                    app_key: key_eventful,
                    keywords: artist,
                    location: location,
                    category: "music,festivals_parades",
                    date: "future",
                    sort_order: "popularity",
                    page_size: page_size,
                    count_only: true
                }
            });
        })
        .then(count => {
            let items = parseInt(count.data.total_items);

            return new Promise((resolve, reject) => {
                if (items >= 0) {
                    resolve(items);
                }
                else {
                    reject(true);
                }
            });
        })
        .then(items => {
            // If there are items, an array of params of get URL
            // is created, for every page of eventful, a request will be send
            page_number = Math.ceil(items / page_size);
            let params_array = [];
            for (let i = 1; i <= page_number; i++) {
                params_array.push({
                    params: {
                        app_key: key_eventful,
                        keywords: artist,
                        location: location,
                        category: "music,festivals_parades",
                        date: "future",
                        sort_order: "popularity",
                        page_size: page_size,
                        page_number: i
                    }
                });
            }

            // With axios, we can perform multiple requests and 
            // process them all when they are all finished
            let promise_array = params_array.map(p => axios.get(events_search_eventful, p));
            return axios.all(promise_array);
        })
        .then(results => {
            // Eventfull processing
            let events = [];            
            results.map(r => r.data.events.event).forEach(events_set => {
                events_set.forEach(event => {
                    if (event.performers != null) {
                        let performers = [];
                        let contains_perf = false;
                        
                        let push_perf = function(name, short_bio) {
                            performers.push({
                                name: use.is_defined(name),
                                short_bio: use.is_defined(short_bio),
                                thumb : "",
                                image: "",
                                facebook: ""
                            });
                            contains_perf = true;
                        };
                        // performers property of eventful is a little dumb
                        // I think, if multiple performers it's an array, else only one object
                        if (Array.isArray(event.performers.performer)) {
                            event.performers.performer.forEach(p => {
                                // eventful keywords is not really top for this case, it match too many results 
                                // with an artist name, it checks his description of events. We are only interested 
                                // by the name of performers. So we check if the name is include in performers name.
                                if ((artist != undefined && p.name.toLowerCase().includes(artist)) || artist == undefined) {
                                    push_perf(p.name, p.short_bio);
                                }
                            });
                        }
                        else {
                            let perf = event.performers.performer;
                            if ((artist != undefined && perf.name.toLowerCase().includes(artist)) || artist == undefined) {
                                push_perf(perf.name, perf.short_bio);
                            }
                        }

                        // Construction of object response
                        if (contains_perf) {
                            events.push({
                                id: use.is_defined(event.id),
                                title: use.is_defined(event.title),
                                venue: use.is_defined(event.venue_name),
                                date: use.is_defined(event.start_time),
                                address: use.is_defined(event.venue_address),
                                city: use.is_defined(event.city_name),
                                region: use.is_defined(event.region_name),
                                postal_code: use.is_defined(event.postal_code),
                                country: use.is_defined(event.country_name),
                                latitude: use.is_defined(event.latitude),
                                longitude: use.is_defined(event.longitude),
                                offer: use.is_defined(event.url),
                                performers: use.is_defined(performers)
                            });
                        }
                    }
                });
            });
            
            return new Promise((resolve, reject) => {
                if (events.length > 0) {
                    resolve(events);
                }
                else {
                    reject(true);
                }
            });
        })
        .then(events => {
            // BandsInTown comes into play
            if (artist != undefined) {
                axios.get(use.url_bands_in_town(artist, "asdf"))
                .then(resp => {
                    events.forEach(event => {
                        event.performers.forEach(perf => {
                            perf.thumb = use.is_defined(resp.data.thumb_url);
                            perf.image = use.is_defined(resp.data.image_url);
                            perf.facebook = use.is_defined(resp.data.facebook_page_url);
                        });
                    });

                    res.status(200).end(JSON.stringify({events: events}));
                })
                .catch(error => {
                    log.warning(error);
                    res.status(200).end(JSON.stringify({events: events}));
                });
            }
            else {
                res.status(200).end(JSON.stringify({events: events}));
            }
            log.debug("events\n", events);
            log.debug("events length", events.length);
        })
        .catch(error => {
            log.error("no_events");
            res.status(404).end(JSON.stringify({no_events: true}));
        });
    }
};
