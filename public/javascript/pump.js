// pump.js
//
// Gigantoscript for the pump.io client UI
//
// Copyright 2011-2012, StatusNet Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// XXX: this module has grown bit by bit, and needs to be broken up
// or I'm going to go crazy. Maybe models, views, and router + setup?
// Also consider requireJS and AMD

var Pump = (function(_, $, Backbone) {

    var searchParams = function(str) {
        var params = {},
            pl     = /\+/g,
            decode = function (s) { return decodeURIComponent(s.replace(pl, " ")); },
            pairs;

        if (!str) {
            str = window.location.search;
        }
        
        pairs = str.substr(1).split("&");

        _.each(pairs, function(pairStr) {
            var pair = pairStr.split("=", 2),
                key = decode(pair[0]),
                value = (pair.length > 1) ? decode(pair[1]) : null;
            
            params[key] = value;
        });

        return params;
    };

    var getContinueTo = function() {
        var sp = searchParams(),
            continueTo = (_.has(sp, "continue")) ? sp["continue"] : null;
        if (continueTo && continueTo.length > 0 && continueTo[0] == "/") {
            return continueTo;
        } else {
            return "";
        }
    };

    // Override backbone sync to use OAuth

    Backbone.sync = function(method, model, options) {

        var getValue = function(object, prop) {
            if (!(object && object[prop])) return null;
            return _.isFunction(object[prop]) ? object[prop]() : object[prop];
        };

        var methodMap = {
            'create': 'POST',
            'update': 'PUT',
            'delete': 'DELETE',
            'read':   'GET'
        };

        var type = methodMap[method];

        // Default options, unless specified.

        options = options || {};

        // Default JSON-request options.
        var params = {type: type, dataType: 'json'};

        // Ensure that we have a URL.

        if (!options.url) {

            if (type == 'POST') {
                params.url = getValue(model.collection, 'url');
            } else if (type == 'GET' && options.update && model.prevLink) {
                params.url = model.prevLink;
            } else {
                params.url = getValue(model, 'url');
            }

            if (!params.url || !_.isString(params.url)) { 
                throw new Error("No URL");
            }
        }

        // Ensure that we have the appropriate request data.
        if (!options.data && model && (method == 'create' || method == 'update')) {
            params.contentType = 'application/json';
            params.data = JSON.stringify(model.toJSON());
        }

        // Don't process data on a non-GET request.
        if (params.type !== 'GET' && !Backbone.emulateJSON) {
            params.processData = false;
        }

        Pump.ensureCred(function(err, cred) {
            var pair;
            if (err) {
                Pump.error("Error getting OAuth credentials.");
            } else {
                params = _.extend(params, options);

                params.consumerKey = cred.clientID;
                params.consumerSecret = cred.clientSecret;

                pair = Pump.getUserCred();

                if (pair) {
                    params.token = pair.token;
                    params.tokenSecret = pair.secret;
                }

                params = Pump.oauthify(params);

                $.ajax(params);
            }
        });

        return null;
    };

    var Pump = {};

    // When errors happen, and you don't know what to do with them,
    // send them here and I'll figure it out.

    Pump.error = function(err) {
        console.log(err);
    };

    Pump.fullURL = function(url) {

        var here = window.location;

        if (url.indexOf(':') == -1) {
            if (url.substr(0, 1) == '/') {
                url = here.protocol + '//' + here.host + url;
            } else {
                url = here.href.substr(0, here.href.lastIndexOf('/') + 1) + url;
            }
        }

        return url;
    };

    Pump.oauthify = function(options) {

        options.url = Pump.fullURL(options.url);

        var message = {action: options.url,
                       method: options.type,
                       parameters: [["oauth_version", "1.0"],
                                    ["oauth_consumer_key", options.consumerKey]]};

        if (options.token) {
            message.parameters.push(["oauth_token", options.token]);
        }

        OAuth.setTimestampAndNonce(message);
        OAuth.SignatureMethod.sign(message,
                                   {consumerSecret: options.consumerSecret,
                                    tokenSecret: options.tokenSecret});

        var header =  OAuth.getAuthorizationHeader("OAuth", message.parameters);

        options.headers = {Authorization: header};

        return options;
    };

    // This is overwritten by inline script in layout.utml

    Pump.config = {};

    // A little bit of model sugar
    // Create Model attributes for our object-y things

    Pump.Model = Backbone.Model.extend({

        activityObjects: [],
        activityObjectBags: [],
        activityObjectStreams: [],
        activityStreams: [],
        peopleStreams: [],
        people: [],

        initialize: function() {

            var obj = this,
                neverNew = function() { // XXX: neverNude
                    return false;
                },
                initer = function(obj, model) {
                    return function(name) {
                        var raw = obj.get(name);
                        if (raw) {
                            // use unique for cached stuff
                            if (model.unique) {
                                obj[name] = model.unique(raw);
                            } else {
                                obj[name] = new model(raw);
                            }
                            obj[name].isNew = neverNew;
                        }
                        obj.on("change:"+name, function(changed) {
                            var raw = obj.get(name);
                            if (obj[name] && obj[name].set) {
                                obj[name].set(raw);
                            } else if (raw) {
                                if (model.unique) {
                                    obj[name] = model.unique(raw);
                                } else {
                                    obj[name] = new model(raw);
                                }
                                obj[name].isNew = neverNew;
                            }
                        });
                    };
                };

            _.each(obj.activityObjects, initer(obj, Pump.ActivityObject));
            _.each(obj.activityObjectBags, initer(obj, Pump.ActivityObjectBag));
            _.each(obj.activityObjectStreams, initer(obj, Pump.ActivityObjectStream));
            _.each(obj.activityStreams, initer(obj, Pump.ActivityStream));
            _.each(obj.peopleStreams, initer(obj, Pump.PeopleStream));
            _.each(obj.people, initer(obj, Pump.Person));

        },
        toJSON: function() {

            var obj = this,
                json = _.clone(obj.attributes),
                jsoner = function(name) {
                    if (_.has(obj, name)) {
                        if (obj[name].toCollectionJSON) {
                            json[name] = obj[name].toCollectionJSON();
                        } else {
                            json[name] = obj[name].toJSON();
                        }
                    }
                };

            _.each(obj.activityObjects, jsoner);
            _.each(obj.activityObjectBags, jsoner);
            _.each(obj.activityObjectStreams, jsoner);
            _.each(obj.activityStreams, jsoner);
            _.each(obj.peopleStreams, jsoner);
            _.each(obj.people, jsoner);

            return json;
        }
    },
    {
        cache: {},
        keyAttr: "id", // works for activities and activityobjects
        unique: function(props) {
            var inst,
                cls = this,
                key = props[cls.keyAttr],
                cached;

            if (key && _.has(cls.cache, key)) {
                cached = cls.cache[key];
                // Check the updated flag
                if (_.has(props, "updated") &&
                    cached.has("updated") &&
                    cached.get("updated") >= props.updated) {
                    return cached;
                }
            }

            inst = new cls(props);

            if (key) {
                cls.cache[key] = inst;
            }

            inst.on("change:"+cls.keyAttr, function(model, key) {
                var oldKey = model.previous(cls.keyAttr);
                if (oldKey && _.has(cls.cache, oldKey)) {
                    delete cls.cache[oldKey];
                }
                cls.cache[key] = inst;
            });

            return inst;
        }
    });

    // Our own collection. It's a little screwy; there are
    // a few ways to represent a collection in ActivityStreams JSON and
    // the "infinite stream" thing throws things off a bit too.

    Pump.Collection = Backbone.Collection.extend({
        constructor: function(models, options) {
            var coll = this;
            // If we're being initialized with a JSON Collection, parse it.
            if (_.isObject(models) && !_.isArray(models)) {
                models = coll.parse(models);
            }
            if (_.isObject(options) && _.has(options, "url")) {
                coll.url = options.url;
                delete options.url;
            }
            // Use unique() to get unique items
            models = _.map(models, function(raw) {
                return coll.model.unique(raw);
            });
            Backbone.Collection.apply(this, [models, options]);
        },
        parse: function(response) {
            if (_.has(response, "url")) {
                this.url = response.url;
            }
            if (_.has(response, "totalItems")) {
                this.totalItems = response.totalItems;
            }
            if (_.has(response, "links")) {
                if (_.has(response.links, "next")) {
                    this.nextLink = response.links.next.href;
                }
                if (_.has(response.links, "prev")) {
                    this.prevLink = response.links.prev.href;
                }
            }
            if (_.has(response, "items")) {
                return response.items;
            } else {
                return [];
            }
        },
        toCollectionJSON: function() {
            var rep = {};
            if (_.has(this, "totalItems")) {
                rep.totalItems = this.totalItems;
            }
            if (_.has(this, "url")) {
                rep.url = this.url;
            }
            // Don't JSONize models; too much likelihood of a loop
            return rep;
        }
    },
    {
        cache: {},
        keyAttr: "url", // works for in-model collections
        unique: function(models, options) {
            var inst,
                cls = this,
                key,
                cached;

            // If we're being initialized with a JSON Collection, parse it.
            if (_.isObject(models) && !_.isArray(models)) {
                key = models[cls.keyAttr];
            } else if (_.isObject(options) && _.has(options, cls.keyAttr)) {
                key = options[cls.keyAttr];
            }

            if (key && _.has(cls.cache, key)) {
                cached = cls.cache[key];
                return cached;
            }

            inst = new cls(models, options);

            if (key) {
                cls.cache[key] = inst;
            }

            inst.on("change:"+cls.keyAttr, function(model, key) {
                var oldKey = model.previous(cls.keyAttr);
                if (oldKey && _.has(cls.cache, oldKey)) {
                    delete cls.cache[oldKey];
                }
                cls.cache[key] = inst;
            });

            return inst;
        }
    });

    // A social activity.

    Pump.Activity = Pump.Model.extend({
        activityObjects: ['actor', 'object', 'target', 'generator', 'provider', 'location'],
        activityObjectBags: ['to', 'cc', 'bto', 'bcc'],
        url: function() {
            var links = this.get("links"),
                uuid = this.get("uuid");
            if (links && _.isObject(links) && links.self) {
                return links.self;
            } else if (uuid) {
                return "/api/activity/" + uuid;
            } else {
                return null;
            }
        }
    });

    Pump.ActivityStream = Pump.Collection.extend({
        model: Pump.Activity,
        add: function(models, options) {
            // Always add at the beginning of the list
            if (!_.has(options, 'at')) {
                options.at = 0;
            }
            Backbone.Collection.prototype.add.apply(this, [models, options]);
        }
    });

    Pump.ActivityObject = Pump.Model.extend({
        activityObjects: ['author', 'location', 'inReplyTo'],
        activityObjectBags: ['attachments', 'tags'],
        activityObjectStreams: ['likes', 'replies', 'shares'],
        url: function() {
            var links = this.get("links"),
                uuid = this.get("uuid"),
                objectType = this.get("objectType");
            if (links &&
                _.isObject(links) && 
                _.has(links, "self") &&
                _.isObject(links.self) &&
                _.has(links.self, "href") &&
                _.isString(links.self.href)) {
                return links.self.href;
            } else if (objectType) {
                return "/api/"+objectType+"/" + uuid;
            } else {
                return null;
            }
        }
    });

    Pump.fetchObjects = function(orig, callback) {
        var fetched = 0,
            objs = (orig.length) > 0 ? orig.slice(0) : [], // make a dupe in case arg is changed
            count = objs.length,
            done = false,
            onSuccess = function() {
                if (!done) {
                    fetched++;
                    if (fetched >= count) {
                        done = true;
                        callback(objs);
                    }
                }
            },
            onError = function() {
                if (!done) {
                    done = true;
                    callback(null);
                }
            };

        _.each(objs, function(obj) {
            try {
                obj.fetch({success: onSuccess,
                           error: onError});
            } catch (e) {
                Pump.error(e.message);
                onError();
            }
        });
    };

    Pump.Person = Pump.ActivityObject.extend({
        objectType: "person",
        activityObjectStreams: ['favorites', 'lists'],
        peopleStreams: ['followers', 'following'],
        initialize: function() {
            Pump.Model.prototype.initialize.apply(this, arguments);
        }
    });

    Pump.ActivityObjectStream = Pump.Collection.extend({
        model: Pump.ActivityObject
    });

    // Unordered, doesn't have an URL

    Pump.ActivityObjectBag = Backbone.Collection.extend({
        model: Pump.ActivityObject
    });

    Pump.PeopleStream = Pump.ActivityObjectStream.extend({
        model: Pump.Person
    });

    Pump.User = Pump.Model.extend({
        idAttribute: "nickname",
        people: ['profile'],
        initialize: function() {
            var user = this,
                streamUrl = function(rel) {
                    return "/api/user/" + user.get("nickname") + rel;
                },
                userStream = function(rel) {
                    return Pump.ActivityStream.unique([], {url: streamUrl(rel)});
                };

            Pump.Model.prototype.initialize.apply(this, arguments);

            // XXX: maybe move some of these to Person...?

            user.inbox =            userStream("/inbox");
            user.majorInbox =       userStream("/inbox/major");
            user.minorInbox =       userStream("/inbox/minor");
            user.directInbox =      userStream("/inbox/direct");
            user.majorDirectInbox = userStream("/inbox/direct/major");
            user.minorDirectInbox = userStream("/inbox/direct/minor");
            user.stream =           userStream("/feed");
            user.majorStream =      userStream("/feed/major");
            user.minorStream =      userStream("/feed/minor");

            user.on("change:nickname", function() {
                user.inbox.url            = streamUrl("/inbox");
                user.majorInbox.url       = streamUrl("/inbox/major");
                user.minorInbox.url       = streamUrl("/inbox/minor");
                user.directInbox.url      = streamUrl("/inbox/direct");
                user.majorDirectInbox.url = streamUrl("/inbox/direct/major");
                user.minorDirectInbox.url = streamUrl("/inbox/direct/minor");
                user.stream.url           = streamUrl("/feed");
                user.majorStream.url      = streamUrl("/feed/major");
                user.minorStream.url      = streamUrl("/feed/minor");
            });
        },
        isNew: function() {
            // Always PUT
            return false;
        },
        url: function() {
            return "/api/user/" + this.get("nickname");
        }
    },
    {
        cache: {}, // separate cache
        keyAttr: "nickname" // cache by nickname
    });

    Pump.currentUser = null; // XXX: load from server...?

    Pump.templates = {};

    Pump.TemplateError = function(template, data, err) {
        Error.captureStackTrace(this, Pump.TemplateError);
        this.name     = "TemplateError";
        this.template = template;
        this.data     = data;
        this.wrapped  = err;
        this.message  = ((_.has(template, "templateName")) ? template.templateName : "unknown-template") + ": " + err.message;
    };

    Pump.TemplateError.prototype = new Error();
    Pump.TemplateError.prototype.constructor = Pump.TemplateError;

    Pump.TemplateView = Backbone.View.extend({
        initialize: function(options) {
            var view = this;

            if (_.has(view, "model") && _.isObject(view.model)) {
                view.listenTo(view.model, "change", function(options) {
                    // When a change has happened, re-render
                    view.render();
                });
                view.listenTo(view.model, "destroy", function(options) {
                    // When a change has happened, re-render
                    view.remove();
                });
            } else if (_.has(view, "collection") && _.isObject(view.collection)) {
                view.listenTo(view.collection, "add", function(model, collection, options) {
                    // When a change has happened, re-render
                    view.render();
                });
                view.listenTo(view.collection, "remove", function(model, collection, options) {
                    // When a change has happened, re-render
                    view.render();
                });
                view.listenTo(view.collection, "reset", function(collection, options) {
                    // When a change has happened, re-render
                    view.render();
                });
                view.listenTo(view.collection, "sort", function(collection, options) {
                    // When a change has happened, re-render
                    view.render();
                });
            }
        },
        setElement: function(element, delegate) {
            Backbone.View.prototype.setElement.apply(this, arguments);
            if (element) {
                this.ready();
                this.trigger("ready");
            }
        },
        templateName: null,
        parts: null,
        subs: {},
        ready: function() {
            // setup subViews
            this.setupSubs();
        },
        setupSubs: function() {

            var view = this,
                data = view.options.data,
                subs = view.subs;

            if (!subs) {
                return;
            }

            _.each(subs, function(def, selector) {

                var $el = view.$(selector),
                    options,
                    sub,
                    id;

                if (def.attr && view[def.attr]) {
                    view[def.attr].setElement($el);
                    return;
                }

                if (def.idAttr && view.collection) {

                    if (def.map) {
                        if (!view[def.map]) {
                            view[def.map] = {};
                        }
                    }

                    $el.each(function(i, el) {

                        var id = $(el).attr(def.idAttr),
                            options = {el: el};

                        if (!id) {
                            return;
                        }

                        options.model = view.collection.get(id);

                        if (!options.model) {
                            return;
                        }

                        sub = new Pump[def.subView](options);

                        if (def.map) {
                            view[def.map][id] = sub;
                        }
                    });

                    return;
                }

                options = {el: $el};

                if (def.subOptions) {
                    if (def.subOptions.model) {
                        options.model = data[def.subOptions.model];
                    }
                    if (def.subOptions.collection) {
                        options.collection = data[def.subOptions.collection];
                    }
                    if (def.subOptions.data) {
                        options.data = {};
                        _.each(def.subOptions.data, function(item) {
                            options.data[item] = data[item];
                        });
                    }
                }
                
                sub = new Pump[def.subView](options);
                   
                if (def.attr) {
                    view[def.attr] = sub;
                }
            });
        },
        render: function() {
            var view = this,
                getTemplate = function(name, cb) {
                    var url;
                    if (_.has(Pump.templates, name)) {
                        cb(null, Pump.templates[name]);
                    } else {
                        $.get('/template/'+name+'.utml', function(data) {
                            var f;
                            try {
                                f = _.template(data);
                                f.templateName = name;
                                Pump.templates[name] = f;
                            } catch (err) {
                                cb(err, null);
                                return;
                            }
                            cb(null, f);
                        });
                    }
                },
                getTemplateSync = function(name) {
                    var f, data, res;
                    if (_.has(Pump.templates, name)) {
                        return Pump.templates[name];
                    } else {
                        res = $.ajax({url: '/template/'+name+'.utml',
                                      async: false});
                        if (res.readyState === 4 &&
                            ((res.status >= 200 && res.status < 300) || res.status === 304)) {
                            data = res.responseText;
                            f = _.template(data);
                            f.templateName = name;
                            Pump.templates[name] = f;
                        }
                        return f;
                    }
                },
                runTemplate = function(template, data, cb) {
                    var html;
                    try {
                        html = template(data);
                    } catch (err) {
                        cb(new Pump.TemplateError(template, data, err), null);
                        return;
                    }
                    cb(null, html);
                },
                setOutput = function(err, html) {
                    if (err) {
                        Pump.error(err);
                    } else {
                        // Triggers "ready"
                        view.setHTML(html);
                        // Update relative to the new code view
                        view.$("abbr.easydate").easydate();
                    }
                },
                main = {
                    config: Pump.config,
                    data: {},
                    template: {},
                    page: {}
                },
                pc,
                modelName = view.modelName || view.options.modelName || "model",
                partials,
                cnt;

            if (view.collection) {
                main.data[modelName] = view.collection.toJSON();
            } else if (view.model) {
                main.data[modelName] = (!view.model) ? {} : ((view.model.toJSON) ? view.model.toJSON() : view.model);
            }

            if (_.has(view.options, "data")) {
                _.each(view.options.data, function(obj, name) {
                    if (obj.toJSON) {
                        main.data[name] = obj.toJSON();
                    } else {
                        main.data[name] = obj;
                    }
                });
            }

            if (Pump.currentUser && !_.has(main.data, "user")) {
                main.data.user = Pump.currentUser.toJSON();
            }

            main.partial = function(name, locals) {
                var template, scoped;
                if (locals) {
                    scoped = _.clone(locals);
                    _.extend(scoped, main);
                } else {
                    scoped = main;
                }
                if (!_.has(partials, name)) {
                    console.log("Didn't preload template " + name + " so fetching sync");
                    // XXX: Put partials in the parts array of the
                    // view to avoid this shameful sync call
                    partials[name] = getTemplateSync(name);
                }
                template = partials[name];
                if (!template) {
                    throw new Error("No template for " + name);
                }
                return template(scoped);
            };

            // XXX: set main.page.title

            // If there are sub-parts, we do them in parallel then
            // do the main one. Note: only one level.

            if (view.parts) {
                pc = 0;
                cnt = _.keys(view.parts).length;
                partials = {};
                _.each(view.parts, function(templateName) {
                    getTemplate(templateName, function(err, template) {
                        if (err) {
                            Pump.error(err);
                        } else {
                            pc++;
                            partials[templateName] = template;
                            if (pc >= cnt) {
                                getTemplate(view.templateName, function(err, template) {
                                    runTemplate(template, main, setOutput);
                                });
                            }
                        }
                    });
                });
            } else {
                getTemplate(view.templateName, function(err, template) {
                    runTemplate(template, main, setOutput);
                });
            }
            return this;
        },
        stopSpin: function() {
            this.$(':submit').prop('disabled', false).spin(false);
        },
        startSpin: function() {
            this.$(':submit').prop('disabled', true).spin(true);
        },
        showAlert: function(msg, type) {
            var view = this;

            if (view.$(".alert").length > 0) {
                view.$(".alert").remove();
            }

            type = type || "error";

            view.$("legend").after('<div class="alert alert-'+type+'">' +
                                   '<a class="close" data-dismiss="alert" href="#">&times;</a>' +
                                   '<p class="alert-message">'+ msg + '</p>' +
                                   '</div>');
            
            view.$(".alert").alert();
        },
        showError: function(msg) {
            this.showAlert(msg, "error");
        },
        showSuccess: function(msg) {
            this.showAlert(msg, "success");
        },
        setHTML: function(html) {
            var view = this,
                $old = view.$el,
                $new = $(html).first();

            $old.replaceWith($new);
            view.setElement($new);
            $old = null;
        }
    });

    Pump.AnonymousNav = Pump.TemplateView.extend({
        tagName: "div",
        className: "container",
        templateName: 'nav-anonymous'
    });

    Pump.UserNav = Pump.TemplateView.extend({
        tagName: "div",
        className: "container",
        modelName: "user",
        templateName: 'nav-loggedin',
        events: {
            "click #logout": "logout",
            "click #post-note-button": "postNoteModal",
            "click #post-picture-button": "postPictureModal",
            "click #profile-dropdown": "profileDropdown"
        },
        postNoteModal: function() {
            var profile = Pump.currentUser.profile,
                lists = profile.lists,
                following = profile.following;

            Pump.fetchObjects([lists, following], function(objs) {
                Pump.showModal(Pump.PostNoteModal, {data: {user: Pump.currentUser}});
            });

            return false;
        },
        postPictureModal: function() {
            var profile = Pump.currentUser.profile,
                lists = profile.lists,
                following = profile.following;

            Pump.fetchObjects([lists, following], function(objs) {
                Pump.showModal(Pump.PostPictureModal, {data: {user: Pump.currentUser}});
            });
            return false;
        },
        profileDropdown: function() {
            $('#profile-dropdown').dropdown();
        },
        logout: function() {
            var view = this,
                options,
                onSuccess = function(data, textStatus, jqXHR) {
                    var an;
                    Pump.currentUser = null;

                    Pump.setNickname(null);
                    Pump.setUserCred(null, null);

                    an = new Pump.AnonymousNav({el: ".navbar-inner .container"});
                    an.render();

                    if (Pump.config.sockjs) {
                        // Request a new challenge
                        Pump.setupSocket();
                    }

                    // Reload to clear authenticated stuff

                    Pump.router.navigate(window.location.pathname+"?logout=true", true);
                },
                onError = function(jqXHR, textStatus, errorThrown) {
                    showError(errorThrown);
                },
                showError = function(msg) {
                    Pump.error(msg);
                };

            options = {
                contentType: "application/json",
                data: "",
                dataType: "json",
                type: "POST",
                url: "/main/logout",
                success: onSuccess,
                error: onError
            };

            Pump.ensureCred(function(err, cred) {
                var pair;
                if (err) {
                    showError("Couldn't get OAuth credentials. :(");
                } else {
                    options.consumerKey = cred.clientID;
                    options.consumerSecret = cred.clientSecret;
                    pair = Pump.getUserCred();

                    if (pair) {
                        options.token = pair.token;
                        options.tokenSecret = pair.secret;
                    }

                    options = Pump.oauthify(options);
                    $.ajax(options);
                }
            });
        }
    });

    Pump.ContentView = Pump.TemplateView.extend({
        addMajorActivity: function(act) {
            // By default, do nothing
        },
        addMinorActivity: function(act) {
            // By default, do nothing
        }
    });

    Pump.MainContent = Pump.ContentView.extend({
        templateName: 'main'
    });

    Pump.LoginContent = Pump.ContentView.extend({
        templateName: 'login',
        events: {
            "submit #login": "doLogin"
        },
        "doLogin": function() {
            var view = this,
                params = {nickname: view.$('#login input[name="nickname"]').val(),
                          password: view.$('#login input[name="password"]').val()},
                options,
                continueTo = getContinueTo(),
                NICKNAME_RE = /^[a-zA-Z0-9\-_.]{1,64}$/,
                onSuccess = function(data, textStatus, jqXHR) {
                    var objs;
                    Pump.setNickname(data.nickname);
                    Pump.setUserCred(data.token, data.secret);
                    Pump.currentUser = Pump.User.unique(data);
                    objs = [Pump.currentUser,
                            Pump.currentUser.majorDirectInbox,
                            Pump.currentUser.minorDirectInbox];
                    Pump.fetchObjects(objs, function(objs) {
                        Pump.body.nav = new Pump.UserNav({el: ".navbar-inner .container",
                                                          model: Pump.currentUser,
                                                          data: {
                                                              directMajor: Pump.currentUser.majorDirectInbox,
                                                              directMinor: Pump.currentUser.minorDirectInbox
                                                          }});
                        Pump.body.nav.render();
                    });
                    if (Pump.config.sockjs) {
                        // Request a new challenge
                        Pump.setupSocket();
                    }
                    // XXX: reload current data
                    view.stopSpin();
                    Pump.router.navigate(continueTo, true);
                },
                onError = function(jqXHR, textStatus, errorThrown) {
                    var type, response;
                    view.stopSpin();
                    type = jqXHR.getResponseHeader("Content-Type");
                    if (type && type.indexOf("application/json") !== -1) {
                        response = JSON.parse(jqXHR.responseText);
                        view.showError(response.error);
                    } else {
                        view.showError(errorThrown);
                    }
                };

            view.startSpin();

            options = {
                contentType: "application/json",
                data: JSON.stringify(params),
                dataType: "json",
                type: "POST",
                url: "/main/login",
                success: onSuccess,
                error: onError
            };

            Pump.ensureCred(function(err, cred) {
                if (err) {
                    view.showError("Couldn't get OAuth credentials. :(");
                } else {
                    options.consumerKey = cred.clientID;
                    options.consumerSecret = cred.clientSecret;
                    options = Pump.oauthify(options);
                    $.ajax(options);
                }
            });

            return false;
        }
    });

    Pump.RegisterContent = Pump.ContentView.extend({
        templateName: 'register',
        events: {
            "submit #registration": "register"
        },
        register: function() {
            var view = this,
                params = {nickname: view.$('#registration input[name="nickname"]').val(),
                          password: view.$('#registration input[name="password"]').val()},
                repeat = view.$('#registration input[name="repeat"]').val(),
                email = (Pump.config.requireEmail) ? view.$('#registration input[name="email"]').val() : null,
                options,
                NICKNAME_RE = /^[a-zA-Z0-9\-_.]{1,64}$/,
                onSuccess = function(data, textStatus, jqXHR) {
                    var objs;
                    Pump.setNickname(data.nickname);
                    Pump.setUserCred(data.token, data.secret);
                    Pump.currentUser = Pump.User.unique(data);
                    if (Pump.config.sockjs) {
                        // Request a new challenge
                        Pump.setupSocket();
                    }
                    objs = [Pump.currentUser,
                            Pump.currentUser.majorDirectInbox,
                            Pump.currentUser.minorDirectInbox];
                    Pump.fetchObjects(objs, function(objs) {
                        Pump.body.nav = new Pump.UserNav({el: ".navbar-inner .container",
                                                          model: Pump.currentUser,
                                                          data: {
                                                              directMajor: Pump.currentUser.majorDirectInbox,
                                                              directMinor: Pump.currentUser.minorDirectInbox
                                                          }});
                        Pump.body.nav.render();
                    });
                    Pump.body.nav = new Pump.UserNav({el: ".navbar-inner .container",
                                                      model: Pump.currentUser});
                    Pump.body.nav.render();
                    // Leave disabled
                    view.stopSpin();
                    // XXX: one-time on-boarding page
                    Pump.router.navigate("", true);
                },
                onError = function(jqXHR, textStatus, errorThrown) {
                    var type, response;
                    view.stopSpin();
                    type = jqXHR.getResponseHeader("Content-Type");
                    if (type && type.indexOf("application/json") !== -1) {
                        response = JSON.parse(jqXHR.responseText);
                        view.showError(response.error);
                    } else {
                        view.showError(errorThrown);
                    }
                };

            if (params.password !== repeat) {

                view.showError("Passwords don't match.");

            } else if (!NICKNAME_RE.test(params.nickname)) {

                view.showError("Nicknames have to be a combination of 1-64 letters or numbers and ., - or _.");

            } else if (params.password.length < 8) {

                view.showError("Password must be 8 chars or more.");

            } else if (/^[a-z]+$/.test(params.password.toLowerCase()) ||
                       /^[0-9]+$/.test(params.password)) {

                view.showError("Passwords have to have at least one letter and one number.");

            } else if (Pump.config.requireEmail && (!email || email.length === 0)) {

                view.showError("Email address required.");

            } else {

                if (Pump.config.requireEmail) {
                    params.email = email;
                }

                view.startSpin();

                options = {
                    contentType: "application/json",
                    data: JSON.stringify(params),
                    dataType: "json",
                    type: "POST",
                    url: "/main/register",
                    success: onSuccess,
                    error: onError
                };

                Pump.ensureCred(function(err, cred) {
                    if (err) {
                        view.showError("Couldn't get OAuth credentials. :(");
                    } else {
                        options.consumerKey = cred.clientID;
                        options.consumerSecret = cred.clientSecret;
                        options = Pump.oauthify(options);
                        $.ajax(options);
                    }
                });
            }

            return false;
        }
    });

    Pump.UserPageContent = Pump.ContentView.extend({
        templateName: 'user',
        parts: ["profile-block",
                "user-content-activities",
                "major-stream-headless",
                "sidebar-headless",
                "major-activity-headless",
                "minor-activity-headless",
                "responses",
                "reply",
                "profile-responses",
                "activity-object-list",
                "activity-object-collection"
               ],
        addMajorActivity: function(act) {
            var view = this,
                profile = this.options.data.profile,
                aview;

            if (!profile || act.actor.id != profile.get("id")) {
                return;
            }

            aview = new Pump.MajorActivityHeadlessView({model: act});
            aview.on("ready", function() {
                aview.$el.hide();
                view.$("#major-stream").prepend(aview.$el);
                aview.$el.slideDown('slow');
            });
            aview.render();
        },
        addMinorActivity: function(act) {
            var view = this,
                profile = this.options.data.profile,
                aview;

            if (!profile || act.actor.id != profile.get("id")) {
                return;
            }

            aview = new Pump.MinorActivityHeadlessView({model: act});

            aview.on("ready", function() {
                aview.$el.hide();
                view.$("#minor-stream").prepend(aview.$el);
                aview.$el.slideDown('slow');
            });
            aview.render();
        },
        subs: {
            "#profile-block": {
                attr: "profileBlock",
                subView: "ProfileBlock",
                subOptions: {
                    model: "profile"
                }
            },
            "#user-content-activities": {
                attr: "userContent",
                subView: "ActivitiesUserContent",
                subOptions: {
                    data: ["major", "minor"]
                }
            }
        }
    });

    Pump.ActivitiesUserContent = Pump.TemplateView.extend({
        templateName: 'user-content-activities',
        parts: ["major-stream-headless",
                "sidebar-headless",
                "major-activity-headless",
                "minor-activity-headless",
                "responses",
                "reply",
                "profile-responses",
                "activity-object-list",
                "activity-object-collection"],
        subs: {
            "#major-stream": {
                attr: "majorStreamView",
                subView: "MajorStreamHeadlessView",
                subOptions: {
                    collection: "major"
                }
            },
            "#sidebar": {
                attr: "minorStreamView",
                subView: "MinorStreamHeadlessView",
                subOptions: {
                    collection: "minor"
                }
            }
        }
    });

    Pump.MajorStreamHeadlessView = Pump.TemplateView.extend({
        templateName: 'major-stream-headless',
        modelName: 'major',
        parts: ["major-activity-headless",
                "responses",
                "reply",
                "activity-object-list",
                "activity-object-collection"],
        subs: {
            ".activity.major": {
                map: "activities",
                subView: "MajorActivityHeadlessView",
                idAttr: "data-activity-id"
            }
        }
    });

    Pump.MinorStreamHeadlessView = Pump.TemplateView.extend({
        templateName: 'sidebar',
        modelName: 'minor',
        parts: ["minor-activity-headless"],
        subs: {
            ".activity.minor": {
                map: "activities",
                subView: "MinorActivityHeadlessView",
                idAttr: "data-activity-id"
            }
        }
    });

    Pump.MajorStreamView = Pump.TemplateView.extend({
        templateName: 'major-stream',
        modelName: 'major',
        parts: ["major-activity",
                "responses",
                "reply",
                "activity-object-list",
                "activity-object-collection"],
        subs: {
            ".activity.major": {
                map: "activities",
                subView: "MajorActivityView",
                idAttr: "data-activity-id"
            }
        }
    });

    Pump.MinorStreamView = Pump.TemplateView.extend({
        templateName: 'sidebar',
        modelName: 'minor',
        parts: ["minor-activity"],
        subs: {
            ".activity.minor": {
                map: "activities",
                subView: "MinorActivityView",
                idAttr: "data-activity-id"
            }
        }
    });

    Pump.InboxContent = Pump.ContentView.extend({
        templateName: 'inbox',
        parts: ["major-stream",
                "sidebar",
                "major-activity",
                "minor-activity",
                "responses",
                "reply",
                "activity-object-list",
                "activity-object-collection"],
        addMajorActivity: function(act) {
            var view = this,
                aview;
            if (view && view.$(".activity.major")) {
                aview = new Pump.MajorActivityView({model: act});
                aview.on("ready", function() {
                    aview.$el.hide();
                    view.$("#major-stream").prepend(aview.$el);
                    aview.$el.slideDown('slow');
                });
                aview.render();
            }
        },
        addMinorActivity: function(act) {
            var view = this,
                aview;
            aview = new Pump.MinorActivityView({model: act});

            aview.on("ready", function() {
                aview.$el.hide();
                view.$("#minor-stream").prepend(aview.$el);
                aview.$el.slideDown('slow');
            });
            aview.render();
        },
        subs: {
            "#major-stream": {
                attr: "majorStreamView",
                subView: "MajorStreamView",
                subOptions: {
                    collection: "major"
                }
            },
            "#sidebar": {
                attr: "minorStreamView",
                subView: "MinorStreamView",
                subOptions: {
                    collection: "minor"
                }
            }
        }
    });

    Pump.MajorActivityView = Pump.TemplateView.extend({
        templateName: 'major-activity',
        parts: ["responses",
                "reply"],
        modelName: "activity",
        events: {
            "click .favorite": "favoriteObject",
            "click .unfavorite": "unfavoriteObject",
            "click .share": "shareObject",
            "click .unshare": "unshareObject",
            "click .comment": "openComment"
        },
        favoriteObject: function() {
            var view = this,
                act = new Pump.Activity({
                    verb: "favorite",
                    object: view.model.object.toJSON()
                }),
                stream = Pump.currentUser.minorStream;

            stream.create(act, {success: function(act) {
                view.$(".favorite")
                    .removeClass("favorite")
                    .addClass("unfavorite")
                    .html("Unlike <i class=\"icon-thumbs-down\"></i>");
                Pump.addMinorActivity(act);
            }});
        },
        unfavoriteObject: function() {
            var view = this,
                act = new Pump.Activity({
                    verb: "unfavorite",
                    object: view.model.object.toJSON()
                }),
                stream = Pump.currentUser.minorStream;

            stream.create(act, {success: function(act) {
                view.$(".unfavorite")
                    .removeClass("unfavorite")
                    .addClass("favorite")
                    .html("Like <i class=\"icon-thumbs-up\"></i>");
                Pump.addMinorActivity(act);
            }});
        },
        shareObject: function() {
            var view = this,
                act = new Pump.Activity({
                    verb: "share",
                    object: view.model.object.toJSON()
                }),
                stream = Pump.currentUser.majorStream;

            stream.create(act, {success: function(act) {
                view.$(".share")
                    .removeClass("share")
                    .addClass("unshare")
                    .html("Unshare <i class=\"icon-remove\"></i>");
                Pump.addMajorActivity(act);
            }});
        },
        unshareObject: function() {
            var view = this,
                act = new Pump.Activity({
                    verb: "unshare",
                    object: view.model.object.toJSON()
                }),
                stream = Pump.currentUser.minorStream;

            stream.create(act, {success: function(act) {
                view.$(".unshare")
                    .removeClass("unshare")
                    .addClass("share")
                    .html("Share <i class=\"icon-share-alt\"></i>");
                Pump.addMinorActivity(act);
            }});
        },
        openComment: function() {
            var view = this,
                form;

            if (view.$("form.post-comment").length > 0) {
                view.$("form.post-comment textarea").focus();
            } else {
                form = new Pump.CommentForm({original: view.model.object});
                form.on("ready", function() {
                    view.$(".replies").append(form.$el);
                });
                form.render();
            }
        }
    });

    // For the user page

    Pump.MajorActivityHeadlessView = Pump.MajorActivityView.extend({
        template: "major-activity-headless"
    });

    Pump.CommentForm = Pump.TemplateView.extend({
        templateName: 'comment-form',
        tagName: "div",
        className: "row comment-form",
        events: {
            "submit .post-comment": "saveComment"
        },
        saveComment: function() {
            var view = this,
                text = view.$('textarea[name="content"]').val(),
                orig = view.options.original,
                act = new Pump.Activity({
                    verb: "post",
                    object: {
                        objectType: "comment",
                        content: text,
                        inReplyTo: {
                            objectType: orig.get("objectType"),
                            id: orig.get("id")
                        }
                    }
                }),
                stream = Pump.currentUser.minorStream;

            view.startSpin();

            stream.create(act, {success: function(act) {

                var object = act.object,
                    repl;

                object.set("author", act.actor); 

                repl = new Pump.ReplyView({model: object});

                // These get stripped for "posts"; re-add it

                repl.on("ready", function() {

                    view.stopSpin();

                    view.$el.replaceWith(repl.$el);
                });

                repl.render();

                Pump.addMinorActivity(act);

            }});

            return false;
        }
    });

    Pump.MajorObjectView = Pump.TemplateView.extend({
        templateName: 'major-object',
        parts: ["responses", "reply"]
    });

    Pump.ReplyView = Pump.TemplateView.extend({
        templateName: 'reply',
        modelName: 'reply'
    });

    Pump.MinorActivityView = Pump.TemplateView.extend({
        templateName: 'minor-activity',
        modelName: "activity"
    });

    Pump.MinorActivityHeadlessView = Pump.MinorActivityView.extend({
        templateName: 'minor-activity-headless'
    });

    Pump.PersonView = Pump.TemplateView.extend({
        events: {
            "click .follow": "followProfile",
            "click .stop-following": "stopFollowingProfile"
        },
        followProfile: function() {
            var view = this,
                act = {
                    verb: "follow",
                    object: view.model.toJSON()
                },
                stream = Pump.currentUser.stream;

            stream.create(act, {success: function(act) {
                view.$(".follow")
                    .removeClass("follow")
                    .removeClass("btn-primary")
                    .addClass("stop-following")
                    .html("Stop following");
            }});
        },
        stopFollowingProfile: function() {
            var view = this,
                act = {
                    verb: "stop-following",
                    object: view.model.toJSON()
                },
                stream = Pump.currentUser.stream;

            stream.create(act, {success: function(act) {
                view.$(".stop-following")
                    .removeClass("stop-following")
                    .addClass("btn-primary")
                    .addClass("follow")
                    .html("Follow");
            }});
        }
    });

    Pump.MajorPersonView = Pump.PersonView.extend({
        templateName: 'major-person',
        modelName: 'person'
    });

    Pump.ProfileBlock = Pump.PersonView.extend({
        templateName: 'profile-block',
        modelName: 'profile'
    });

    Pump.FavoritesContent = Pump.ContentView.extend({
        templateName: 'favorites',
        parts: ["profile-block",
                "user-content-favorites",
                "object-stream",
                "major-object",
                "responses",
                "reply",
                "profile-responses",
                "activity-object-list",
                "activity-object-collection"],
        subs: {
            "#profile-block": {
                attr: "profileBlock",
                subView: "ProfileBlock",
                subOptions: {
                    model: "profile"
                }
            },
            "#user-content-favorites": {
                attr: "userContent",
                subView: "FavoritesUserContent",
                subOptions: {
                    collection: "objects",
                    data: ["profile"]
                }
            }
        }
    });

    Pump.FavoritesUserContent = Pump.TemplateView.extend({
        templateName: 'user-content-favorites',
        modelName: "objects",
        parts: ["object-stream",
                "major-object",
                "responses",
                "reply",
                "profile-responses",
                "activity-object-collection"],
        subs: {
            ".object.major": {
                map: "objects",
                subView: "MajorObjectView",
                idAttr: "data-object-id"
            }
        }
    });

    Pump.FollowersContent = Pump.ContentView.extend({
        templateName: 'followers',
        parts: ["profile-block",
                "user-content-followers",
                "people-stream",
                "major-person",
                "profile-responses"],
        subs: {
            "#profile-block": {
                attr: "profileBlock",
                subView: "ProfileBlock",
                subOptions: {
                    model: "profile"
                }
            },
            "#user-content-followers": {
                attr: "userContent",
                subView: "FollowersUserContent",
                subOptions: {
                    collection: "people",
                    data: ["profile"]
                }
            }
        }
    });

    Pump.FollowersUserContent = Pump.TemplateView.extend({
        templateName: 'user-content-followers',
        modelName: "people",
        parts: ["people-stream",
                "major-person",
                "profile-responses"],
        subs: {
            ".person.major": {
                map: "people",
                subView: "MajorPersonView",
                idAttr: "data-person-id"
            }
        }
    });

    Pump.FollowingContent = Pump.ContentView.extend({
        templateName: 'following',
        parts: ["profile-block",
                'user-content-following',
                "people-stream",
                "major-person",
                "profile-responses"],
        subs: {
            "#profile-block": {
                attr: "profileBlock",
                subView: "ProfileBlock",
                subOptions: {
                    model: "profile"
                }
            },
            "#user-content-following": {
                attr: "userContent",
                subView: "FollowingUserContent",
                subOptions: {
                    collection: "people",
                    data: ["profile"]
                }
            }
        }
    });

    Pump.FollowingUserContent = Pump.TemplateView.extend({
        templateName: 'user-content-following',
        modelName: "people",
        parts: ["people-stream",
                "major-person",
                "profile-responses"],
        subs: {
            ".person.major": {
                map: "people",
                subView: "MajorPersonView",
                idAttr: "data-person-id"
            }
        }
    });

    Pump.ListsContent = Pump.ContentView.extend({
        templateName: 'lists',
        parts: ["profile-block",
                'user-content-lists',
                "list-menu",
                "list-menu-item",
                "profile-responses"],
        subs: {
            "#profile-block": {
                attr: "profileBlock",
                subView: "ProfileBlock",
                subOptions: {
                    model: "profile"
                }
            },
            "#user-content-lists": {
                attr: "userContent",
                subView: "ListsUserContent",
                subOptions: {
                    data: ["profile", "lists"]
                }
            }
        }
    });

    Pump.ListsUserContent = Pump.TemplateView.extend({
        templateName: 'user-content-lists',
        parts: ["list-menu",
                "list-menu-item",
                "list-content-lists"],
        subs: {
            "#list-menu-inner": {
                attr: "listMenu",
                subView: "ListMenu",
                subOptions: {
                    collection: "lists",
                    data: ["profile"]
                }
            }
        }
    });

    Pump.ListMenu = Pump.TemplateView.extend({
        templateName: "list-menu",
        modelName: "profile",
        parts: ["list-menu-item"],
        el: '.list-menu-block',
        events: {
            "click .new-list": "newList"
        },
        newList: function() {
            Pump.showModal(Pump.NewListModal, {data: {user: Pump.currentUser}});
        },
        subs: {
            ".list": {
                map: "lists",
                subView: "ListMenuItem",
                idAttr: "data-list-id"
            }
        }
    });

    Pump.ListMenuItem = Pump.TemplateView.extend({
        templateName: "list-menu-item",
        modelName: "listItem",
        tagName: "ul",
        className: "list-menu-wrapper"
    });

    Pump.ListsListContent = Pump.TemplateView.extend({
        templateName: 'list-content-lists'
    });

    Pump.ListContent = Pump.ContentView.extend({
        templateName: 'list',
        parts: ["profile-block",
                "profile-responses",
                'user-content-list',
                "list-content-list",
                "people-stream",
                "major-person",
                "list-menu",
                "list-menu-item"
               ],
        subs: {
            "#profile-block": {
                attr: "profileBlock",
                subView: "ProfileBlock",
                subOptions: {
                    model: "profile"
                }
            },
            "#user-content-list": {
                attr: "userContent",
                subView: "ListUserContent",
                subOptions: {
                    data: ["profile", "lists", "list"]
                }
            }
        }
    });

    Pump.ListUserContent = Pump.TemplateView.extend({
        templateName: 'user-content-list',
        parts: ["people-stream",
                "list-content-list",
                "major-person",
                "list-menu-item",
                "list-menu"
               ],
        subs: {
            "#list-menu-inner": {
                attr: "listMenu",
                subView: "ListMenu",
                subOptions: {
                    collection: "lists",
                    data: ["profile"]
                }
            },
            "#list-content-list": {
                attr: "listContent",
                subView: "ListListContent",
                subOptions: {
                    model: "list",
                    data: ["profile"]
                }
            }
        }
    });

    Pump.ListListContent = Pump.TemplateView.extend({
        templateName: 'list-content-list',
        modelName: "list",
        parts: ["people-stream",
                "major-person"],
        setupSubs: function() {
            var view = this,
                model = view.model;

            if (model && model.members) {
                model.members.each(function(person) {
                    var $el = view.$("div[data-person-id='"+person.id+"']"),
                        aview;

                    if ($el.length > 0) {
                        aview = new Pump.MajorPersonView({el: $el,
                                                          model: person});
                    }
                });
            }
        }
    });

    Pump.SettingsContent = Pump.ContentView.extend({
        templateName: 'settings',
        modelName: "profile",
        events: {
            "submit #settings": "saveSettings"
        },
        saveSettings: function() {

            var view = this,
                user = Pump.currentUser,
                profile = user.profile;

            view.startSpin();

            profile.save({"displayName": this.$('#realname').val(),
                          "location": { objectType: "place", 
                                        displayName: this.$('#location').val() },
                          "summary": this.$('#bio').val()},
                         {
                             success: function(resp, status, xhr) {
                                 user.set("profile", profile);
                                 view.showSuccess("Saved settings.");
                                 view.stopSpin();
                             },
                             error: function(model, error, options) {
                                 view.showError(error.message);
                                 view.stopSpin();
                             }
                         });

            return false;
        }
    });

    Pump.AccountContent = Pump.ContentView.extend({
        templateName: 'account',
        modelName: "user",
        events: {
            "submit #account": "saveAccount"
        },
        saveAccount: function() {
            var view = this,
                user = Pump.currentUser,
                password = view.$('#password').val(),
                repeat = view.$('#repeat').val();

            if (password !== repeat) {

                view.showError("Passwords don't match.");

            } else if (password.length < 8) {

                view.showError("Password must be 8 chars or more.");

            } else if (/^[a-z]+$/.test(password.toLowerCase()) ||
                       /^[0-9]+$/.test(password)) {

                view.showError("Passwords have to have at least one letter and one number.");

            } else {

                view.startSpin();

                user.save("password",
                          password,
                          {
                              success: function(resp, status, xhr) {
                                  view.showSuccess("Saved.");
                                  view.stopSpin();
                              },
                              error: function(model, error, options) {
                                  view.showError(error.message);
                                  view.stopSpin();
                              }
                          }
                         );
            }
            
            return false;
        }
    });

    Pump.AvatarContent = Pump.ContentView.extend({
        templateName: 'avatar',
        modelName: "profile"
    });

    Pump.ObjectContent = Pump.ContentView.extend({
        templateName: 'object',
        modelName: "object",
        parts: ["responses",
                "reply",
                "activity-object-collection"]
    });

    Pump.PostNoteModal = Pump.TemplateView.extend({

        tagName: "div",
        className: "modal-holder",
        templateName: 'post-note',
        ready: function() {
            var view = this;
            view.$('#note-content').wysihtml5({
                customTemplates: Pump.wysihtml5Tmpl
            });
            view.$("#note-to").select2();
            view.$("#note-cc").select2();
        },
        events: {
            "click #send-note": "postNote"
        },
        postNote: function(ev) {
            var view = this,
                text = view.$('#post-note #note-content').val(),
                to = view.$('#post-note #note-to').val(),
                cc = view.$('#post-note #note-cc').val(),
                act = new Pump.Activity({
                    verb: "post",
                    object: {
                        objectType: "note",
                        content: text
                    }
                }),
                stream = Pump.currentUser.majorStream,
                strToObj = function(str) {
                    var colon = str.indexOf(":"),
                        type = str.substr(0, colon),
                        id = str.substr(colon+1);
                    return new Pump.ActivityObject({
                        id: id,
                        objectType: type
                    });
                };

            if (to && to.length > 0) {
                act.to = new Pump.ActivityObjectBag(_.map(to, strToObj));
            }

            if (cc && cc.length > 0) {
                act.cc = new Pump.ActivityObjectBag(_.map(cc, strToObj));
            }

            view.startSpin();
            
            stream.create(act, {success: function(act) {
                view.$el.modal('hide');
                view.stopSpin();
                Pump.resetWysihtml5(view.$('#note-content'));
                // Reload the current page
                Pump.addMajorActivity(act);
            }});
        }
    });

    Pump.PostPictureModal = Pump.TemplateView.extend({
        tagName: "div",
        className: "modal-holder",
        templateName: 'post-picture',
        events: {
            "click #send-picture": "postPicture"
        },
        ready: function() {
            var view = this;

            view.$("#picture-to").select2();
            view.$("#picture-cc").select2();

            view.$('#picture-description').wysihtml5({
                customTemplates: Pump.wysihtml5Tmpl
            });

            if (view.$("#picture-fineupload").length > 0) {
                view.$("#picture-fineupload").fineUploader({
                    request: {
                        endpoint: "/main/upload"
                    },
                    text: {
                        uploadButton: '<i class="icon-upload icon-white"></i> Picture file'
                    },
                    template: '<div class="qq-uploader">' +
                        '<pre class="qq-upload-drop-area"><span>{dragZoneText}</span></pre>' +
                        '<div class="qq-upload-button btn btn-success">{uploadButtonText}</div>' +
                        '<ul class="qq-upload-list"></ul>' +
                        '</div>',
                    classes: {
                        success: 'alert alert-success',
                        fail: 'alert alert-error'
                    },
                    autoUpload: false,
                    multiple: false,
                    validation: {
                        allowedExtensions: ["jpeg", "jpg", "png", "gif", "svg", "svgz"],
                        acceptFiles: "image/*"
                    }
                }).on("complete", function(event, id, fileName, responseJSON) {

                    var stream = Pump.currentUser.majorStream,
                        to = view.$('#post-picture #picture-to').val(),
                        cc = view.$('#post-picture #picture-cc').val(),
                        strToObj = function(str) {
                            var colon = str.indexOf(":"),
                                type = str.substr(0, colon),
                                id = str.substr(colon+1);
                            return new Pump.ActivityObject({
                                id: id,
                                objectType: type
                            });
                        },
                        act = new Pump.Activity({
                            verb: "post",
                            object: responseJSON.obj
                        });

                    if (to && to.length > 0) {
                        act.to = new Pump.ActivityObjectBag(_.map(to, strToObj));
                    }

                    if (cc && cc.length > 0) {
                        act.cc = new Pump.ActivityObjectBag(_.map(cc, strToObj));
                    }

                    stream.create(act, {success: function(act) {
                        view.$el.modal('hide');
                        view.stopSpin();
                        view.$("#picture-fineupload").fineUploader('reset');
                        Pump.resetWysihtml5(view.$('#picture-description'));
                        view.$('#picture-title').val("");
                        // Reload the current content
                        Pump.addMajorActivity(act);
                    }});
                }).on("error", function(event, id, fileName, reason) {
                    view.showError(reason);
                });
            }
        },
        postPicture: function(ev) {
            var view = this,
                description = view.$('#post-picture #picture-description').val(),
                title = view.$('#post-picture #picture-title').val(),
                params = {};

            if (title) {
                params.title = title;
            }

            // XXX: HTML

            if (description) {
                params.description = description;
            }

            view.$("#picture-fineupload").fineUploader('setParams', params);

            view.startSpin();

            view.$("#picture-fineupload").fineUploader('uploadStoredFiles');

        }
    });

    Pump.NewListModal = Pump.TemplateView.extend({

        tagName: "div",
        className: "modal-holder",
        templateName: 'new-list',
        ready: function() {
            var view = this;
            view.$('#list-description').wysihtml5({
                customTemplates: Pump.wysihtml5Tmpl
            });
        },
        events: {
            "click #save-new-list": "saveNewList"
        },
        saveNewList: function() {
            var view = this,
                description = view.$('#new-list #list-description').val(),
                name = view.$('#new-list #list-name').val(),
                act,
                stream = Pump.currentUser.minorStream;

            if (!name) {
                view.showError("Your list must have a name.");
            } else {

                // XXX: any other validation? Check uniqueness here?

                // XXX: to/cc ?

                act = new Pump.Activity({
                    verb: "create",
                    object: new Pump.ActivityObject({
                        objectType: "collection",
                        objectTypes: ["person"],
                        displayName: name,
                        content: description
                    })
                });
                
                view.startSpin();

                stream.create(act, {success: function(act) {
                    var aview;

                    view.$el.modal('hide');
                    view.stopSpin();
                    Pump.resetWysihtml5(view.$('#list-description'));
                    view.$('#list-name').val("");

                    // it's minor

                    Pump.addMinorActivity(act);

                    if ($("#list-menu-inner").length > 0) {
                        aview = new Pump.ListMenuItem({model: act.object});
                        aview.on("ready", function() {
                            var el = aview.$("li");
                            el.hide();
                            $("#list-menu-inner").prepend(el);
                            el.slideDown('fast');
                            // Go to the new list page
                            Pump.router.navigate(act.object.get("url"), true);
                        });
                        aview.render();
                    }
                }});
            }

            return false;
        }
    });

    Pump.BodyView = Backbone.View.extend({
        initialize: function(options) {
            _.bindAll(this, "navigateToHref");
        },
        el: "body",
        events: {
            "click a": "navigateToHref"
        },
        navigateToHref: function(ev) {
            var el = (ev.srcElement || ev.currentTarget),
                pathname = el.pathname, // XXX: HTML5
                here = window.location;

            if (!el.host || el.host === here.host) {
                try {
                    Pump.router.navigate(pathname, true);
                } catch (e) {
                    Pump.error(e);
                }
                // Always return false
                return false;
            } else {
                return true;
            }
        },
        setTitle: function(title) {
            this.$("title").html(title + " - " + Pump.config.site);
        },
        setContent: function(options, callback) {

            var View = options.contentView,
                title = options.title,
                body = this,
                oldContent = body.content,
                userContentOptions,
                listContentOptions,
                newView,
                parent,
                profile;

            if (options.model) {
                profile = options.model;
            } else if (options.data) {
                profile = options.data.profile;
            }

            Pump.unfollowStreams();

            // XXX: double-check this

            body.content = new View(options);

            // We try and only update the parts that have changed

            if (oldContent &&
                options.userContentView &&
                oldContent.profileBlock &&
                oldContent.profileBlock.model.get("id") == profile.get("id")) {

                body.content.profileBlock = oldContent.profileBlock;

                if (options.userContentCollection) {
                    userContentOptions = _.extend({collection: options.userContentCollection}, options);
                } else {
                    userContentOptions = options;
                }

                body.content.userContent = new options.userContentView(userContentOptions);

                if (options.listContentView &&
                    oldContent.userContent.listMenu) {

                    body.content.userContent.listMenu = oldContent.userContent.listMenu;
                    if (options.listContentModel) {
                        listContentOptions = _.extend({model: options.listContentModel}, options);
                    } else {
                        listContentOptions = options;
                    }

                    body.content.userContent.listContent = new options.listContentView(listContentOptions);
                    parent = "#list-content";
                    newView = body.content.userContent.listContent;

                } else {
                    parent = "#user-content";
                    newView = body.content.userContent;
                }
            } else {
                parent = "#content";
                newView = body.content;
            }

            newView.once("ready", function() {
                body.setTitle(title);
                body.$(parent).children().replaceWith(newView.$el);
                Pump.followStreams();
                if (callback) {
                    callback();
                }
            });

            newView.render();
        }
    });

    Pump.modals = {};

    Pump.showModal = function(Cls, options, callback) {

        var modalView,
            templateName = Cls.prototype.templateName;

        if (!callback) {
            callback = options;
            options = {};
        }

        // If we've got it attached already, just show it
        if (_.has(Pump.modals, templateName)) {
            modalView = Pump.modals[templateName];
            modalView.$el.modal('show');
        } else {
            // Otherwise, create a view
            modalView = new Cls(options);
            Pump.modals[templateName] = modalView;
            // When it's ready, show immediately
            modalView.on("ready", function() {
                $("body").append(modalView.el);
                modalView.$el.modal('show');
            });
            // render it (will fire "ready")
            modalView.render();
        }
    };

    Pump.resetWysihtml5 = function(el) {
        var fancy = el.data('wysihtml5');
        if (fancy && fancy.editor && fancy.editor.clear) {
            fancy.editor.clear();
        }
        $(".wysihtml5-command-active", fancy.toolbar).removeClass("wysihtml5-command-active");
        return el;
    };

    Pump.addMajorActivity = function(act) {
        if (Pump.body.content) {
            Pump.body.content.addMajorActivity(act);
        }
    };

    Pump.addMinorActivity = function(act) {
        if (Pump.body.content) {
            Pump.body.content.addMinorActivity(act);
        }
    };

    Pump.Router = Backbone.Router.extend({

        routes: {
            "":                       "home",    
            ":nickname":              "profile",   
            ":nickname/favorites":    "favorites",  
            ":nickname/following":    "following",  
            ":nickname/followers":    "followers",  
            ":nickname/activity/:id": "activity",
            ":nickname/lists":        "lists",
            ":nickname/list/:uuid":   "list",
            ":nickname/:type/:uuid":  "object",
            "main/settings":          "settings",
            "main/account":           "account",
            "main/avatar":            "avatar",
            "main/register":          "register",
            "main/login":             "login"
        },

        register: function() {
            Pump.body.setContent({contentView: Pump.RegisterContent,
                                  title: "Register"});
        },

        login: function() {
            Pump.body.setContent({contentView: Pump.LoginContent,
                                  title: "Login"});
        },

        settings: function() {
            Pump.body.setContent({contentView: Pump.SettingsContent,
                                  model: Pump.currentUser.profile,
                                  title: "Settings"});
        },

        account: function() {
            Pump.body.setContent({contentView: Pump.AccountContent,
                                  model: Pump.currentUser,
                                  title: "Account"});
        },

        avatar: function() {
            Pump.body.setContent({contentView: Pump.AvatarContent,
                                  model: Pump.currentUser.profile,
                                  title: "Avatar"});
        },

        "home": function() {
            var pair = Pump.getUserCred();

            if (pair) {
                var user = Pump.currentUser,
                    major = user.majorInbox,
                    minor = user.minorInbox;

                Pump.fetchObjects([user, major, minor], function(objs) {
                    Pump.body.setContent({contentView: Pump.InboxContent,
                                          data: {major: major,
                                                 minor: minor},
                                          title: "Home"});
                });
            } else {
                Pump.body.setContent({contentView: Pump.MainContent,
                                      title: "Welcome"});
            }
        },

        profile: function(nickname) {
            var router = this,
                user = Pump.User.unique({nickname: nickname}),
                major = user.majorStream,
                minor = user.minorStream;

            Pump.fetchObjects([user, major, minor], function(objs) {
                var profile = user.profile;
                Pump.body.setContent({contentView: Pump.UserPageContent,
                                      userContentView: Pump.ActivitiesUserContent,
                                      title: profile.get("displayName"),
                                      data: { major: major,
                                              minor: minor,
                                              profile: profile }});
            });
        },

        favorites: function(nickname) {
            var router = this,
                user = Pump.User.unique({nickname: nickname}),
                favorites = Pump.ActivityStream.unique([], {url: Pump.fullURL("/api/user/"+nickname+"/favorites")});

            Pump.fetchObjects([user, favorites], function() {
                var profile = user.profile;
                Pump.body.setContent({
                    contentView: Pump.FavoritesContent,
                    userContentView: Pump.FavoritesUserContent,
                    userContentCollection: favorites,
                    title: nickname + " favorites",
                    data: { objects: favorites,
                            profile: profile }
                });
            });
        },

        followers: function(nickname) {
            var router = this,
                user = Pump.User.unique({nickname: nickname}),
                followers = Pump.PeopleStream.unique([], {url: Pump.fullURL("/api/user/"+nickname+"/followers")});

            Pump.fetchObjects([user, followers], function(objs) {
                var profile = user.profile;
                Pump.body.setContent({contentView: Pump.FollowersContent,
                                      userContentView: Pump.FollowersUserContent,
                                      userContentCollection: followers,
                                      title: nickname + " followers",
                                      data: {people: followers,
                                             profile: profile}});
            });
        },

        following: function(nickname) {
            var router = this,
                user = Pump.User.unique({nickname: nickname}),
                following = Pump.PeopleStream.unique([], {url: Pump.fullURL("/api/user/"+nickname+"/following")});

            // XXX: parallelize this?

            Pump.fetchObjects([user, following], function(objs) {
                var profile = user.profile;

                Pump.body.setContent({contentView: Pump.FollowingContent,
                                      userContentView: Pump.FollowingUserContent,
                                      userContentCollection: following,
                                      title: nickname + " following",
                                      data: {people: following,
                                             profile: profile}});
            });
        },

        lists: function(nickname) {
            var router = this,
                user = Pump.User.unique({nickname: nickname}),
                lists = Pump.ActivityObjectStream.unique([], {url: Pump.fullURL("/api/user/"+nickname+"/lists/person")});

            // XXX: parallelize this?

            Pump.fetchObjects([user, lists], function(objs) {
                var profile = user.profile;

                Pump.body.setContent({contentView: Pump.ListsContent,
                                      userContentView: Pump.ListsUserContent,
                                      listContentView: Pump.ListsListContent,
                                      title: nickname + " lists",
                                      data: {lists: lists,
                                             profile: profile}});
            });
        },

        list: function(nickname, uuid) {

            var router = this,
                user = Pump.User.unique({nickname: nickname}),
                lists = Pump.ActivityObjectStream.unique([], {url: Pump.fullURL("/api/user/"+nickname+"/lists/person")}),
                list = Pump.ActivityObject.unique({links: {self: {href: "/api/collection/"+uuid}}});

            // XXX: parallelize this?

            Pump.fetchObjects([user, lists, list], function(objs) {
                var profile = user.profile,
                    options = {contentView: Pump.ListContent,
                               userContentView: Pump.ListUserContent,
                               listContentView: Pump.ListListContent,
                               title: nickname + " - list -" + list.get("displayName"),
                               listContentModel: list,
                               data: {lists: lists,
                                      list: list,
                                      profile: profile}};

                Pump.body.setContent(options, function(view) {
                    Pump.body.content.userContent.listMenu.$(".active").removeClass("active");
                    Pump.body.content.userContent.listMenu.$("li[data-list-id='"+list.id+"']").addClass("active");
                });
            });
        },

        object: function(nickname, type, uuid) {
            var router = this,
                user = Pump.User.unique({nickname: nickname}),
                obj = Pump.ActivityObject.unique({uuid: uuid, objectType: type, userNickname: nickname});

            Pump.fetchObjects([user, obj], function(objs) {
                Pump.body.setContent({contentView: Pump.ObjectContent,
                                      model: obj,
                                      title: obj.displayName || obj.objectType + "by" + nickname});
            });
        }
    });

    Pump.clientID = null;
    Pump.clientSecret = null;
    Pump.nickname = null;
    Pump.token = null;
    Pump.secret = null;
    Pump.credReq = null;

    Pump.setNickname = function(userNickname) {
        Pump.nickname = userNickname;
        if (localStorage) {
            localStorage['cred:nickname'] = userNickname;
        }
    };

    Pump.getNickname = function() {
        if (Pump.nickname) {
            return Pump.nickname;
        } else if (localStorage) {
            return localStorage['cred:nickname'];
        } else {
            return null;
        }
    };

    Pump.getCred = function() {
        if (Pump.clientID) {
            return {clientID: Pump.clientID, clientSecret: Pump.clientSecret};
        } else if (localStorage) {
            Pump.clientID = localStorage['cred:clientID'];
            Pump.clientSecret = localStorage['cred:clientSecret'];
            if (Pump.clientID) {
                return {clientID: Pump.clientID, clientSecret: Pump.clientSecret};
            } else {
                return null;
            }
        } else {
            return null;
        }
    };

    Pump.getUserCred = function(nickname) {
        if (Pump.token) {
            return {token: Pump.token, secret: Pump.secret};
        } else if (localStorage) {
            Pump.token = localStorage['cred:token'];
            Pump.secret = localStorage['cred:secret'];
            if (Pump.token) {
                return {token: Pump.token, secret: Pump.secret};
            } else {
                return null;
            }
        } else {
            return null;
        }
    };

    Pump.setUserCred = function(userToken, userSecret) {
        Pump.token = userToken;
        Pump.secret = userSecret;
        if (localStorage) {
            localStorage['cred:token'] = userToken;
            localStorage['cred:secret'] = userSecret;
        }
        return;
    };

    Pump.ensureCred = function(callback) {
        var cred = Pump.getCred();
        if (cred) {
            callback(null, cred);
        } else if (Pump.credReq) {
            Pump.credReq.success(function(data) {
                callback(null, {clientID: data.client_id,
                                clientSecret: data.client_secret});
            });
            Pump.credReq.error(function() {
                callback(new Error("error getting credentials"), null);
            });
        } else {
            Pump.credReq = $.post("/api/client/register",
                                  {type: "client_associate",
                                   application_name: Pump.config.site + " Web",
                                   application_type: "web"},
                                  function(data) {
                                      Pump.credReq = null;
                                      Pump.clientID = data.client_id;
                                      Pump.clientSecret = data.client_secret;
                                      if (localStorage) {
                                          localStorage['cred:clientID'] = Pump.clientID;
                                          localStorage['cred:clientSecret'] = Pump.clientSecret;
                                      }
                                      callback(null, {clientID: Pump.clientID,
                                                      clientSecret: Pump.clientSecret});
                                  },
                                  "json");
            Pump.credReq.error(function() {
                callback(new Error("error getting credentials"), null);
            });
        }
    };

    Pump.wysihtml5Tmpl = {
        "emphasis": function(locale) {
            return "<li>" +
                "<div class='btn-group'>" +
                "<a class='btn' data-wysihtml5-command='bold' title='"+locale.emphasis.bold+"'><i class='icon-bold'></i></a>" +
                "<a class='btn' data-wysihtml5-command='italic' title='"+locale.emphasis.italic+"'><i class='icon-italic'></i></a>" +
                "<a class='btn' data-wysihtml5-command='underline' title='"+locale.emphasis.underline+"'>_</a>" +
                "</div>" +
                "</li>";
        }
    };

    Pump.setupWysiHTML5 = function() {

        // Set wysiwyg defaults

        $.fn.wysihtml5.defaultOptions["font-styles"] = false;
        $.fn.wysihtml5.defaultOptions["image"] = false;
        $.fn.wysihtml5.defaultOptions["customTemplates"] = Pump.wysihtml5Tmpl;
    };

    Pump.getStreams = function() {

        var content,
            streams = {};

        if (Pump.body && Pump.body.content) {
            if (Pump.body.content.userContent) {
                if (Pump.body.content.userContent.listContent) {
                    content = Pump.body.content.userContent.listContent;
                } else {
                    content = Pump.body.content.userContent;
                }
            } else {
                content = Pump.body.content;
            }
        }

        if (content) {
            if (content.majorStreamView) {
                streams.major = content.majorStreamView.collection;
            }

            if (content.minorStreamView) {
                streams.minor = content.minorStreamView.collection;
            }
        }

        return streams;
    };

    // Refreshes the current visible streams

    Pump.refreshStreams = function() {
        var streams = Pump.getStreams();
        
        _.each(streams, function(stream, name) {
            stream.fetch({update: true, remove: false});
        });
    };

    Pump.updateStream = function(url, activity) {
        var streams = Pump.getStreams(),
            target = _.find(streams, function(stream) { return stream.url == url; }),
            act;

        if (target) {
            act = Pump.Activity.unique(activity);
            target.unshift(act);
        }
    };

    // When we get a challenge from the socket server,
    // We prepare an OAuth request and send it

    Pump.riseToChallenge = function(url, method) {

        var message = {action: url,
                       method: method,
                       parameters: [["oauth_version", "1.0"]]};

        Pump.ensureCred(function(err, cred) {

            var pair, secrets;

            if (err) {
                Pump.error("Error getting OAuth credentials.");
                return;
            }

            message.parameters.push(["oauth_consumer_key", cred.clientID]);
            secrets = {consumerSecret: cred.clientSecret};

            pair = Pump.getUserCred();

            if (pair) {
                message.parameters.push(["oauth_token", pair.token]);
                secrets.tokenSecret = pair.secret;
            }

            OAuth.setTimestampAndNonce(message);

            OAuth.SignatureMethod.sign(message, secrets);

            console.log(message);

            Pump.socket.send(JSON.stringify({cmd: "rise", message: message}));
        });
    };

    // Our socket.io socket

    Pump.socket = null;

    Pump.setupSocket = function() {

        var here = window.location,
            sock;

        if (Pump.socket) {
            Pump.socket.close();
            Pump.socket = null;
        }

        sock = new SockJS(here.protocol + "//" + here.host + "/main/realtime/sockjs");

        sock.onopen = function() {
            Pump.socket = sock;
            Pump.followStreams();
        };

        sock.onmessage = function(e) {
            var data = JSON.parse(e.data);

            switch (data.cmd) {
            case "update":
                Pump.updateStream(data.url, data.activity);
                break;
            case "challenge":
                Pump.riseToChallenge(data.url, data.method);
                break;
            }
        };

        sock.onclose = function() {
            // XXX: reconnect?
            Pump.socket = null;
        };
    };

    Pump.followStreams = function() {

        if (!Pump.config.sockjs) {
            return;
        }

        if (!Pump.socket) {
            return;
        }

        var streams = Pump.getStreams();
        
        _.each(streams, function(stream, name) {
            Pump.socket.send(JSON.stringify({cmd: "follow", url: stream.url}));
        });
    };

    Pump.unfollowStreams = function() {

        if (!Pump.config.sockjs) {
            return;
        }

        if (!Pump.socket) {
            return;
        }

        var streams = Pump.getStreams();
        
        _.each(streams, function(stream, name) {
            Pump.socket.send(JSON.stringify({cmd: "unfollow", url: stream.url}));
        });
    };

    $(document).ready(function() {

        // XXX: set up initial models
        
        // Set up router

        Pump.router   = new Pump.Router();

        // Set up initial view

        Pump.body     = new Pump.BodyView({el: $("body")});
        Pump.body.nav = new Pump.AnonymousNav({el: ".navbar-inner .container"});

        // XXX: Make this more complete

        if ($("#content #login").length > 0) {
            Pump.body.content = new Pump.LoginContent();
        } else if ($("#content #registration").length > 0) {
            Pump.body.content = new Pump.RegisterContent();
        } else if ($("#content #user").length > 0) {
            Pump.body.content = new Pump.UserPageContent({});
        } else if ($("#content #inbox").length > 0) {
            Pump.body.content = new Pump.InboxContent({});
        }

        $("abbr.easydate").easydate();

        Backbone.history.start({pushState: true, silent: true});

        Pump.setupWysiHTML5();

        // Refresh the streams every 60 seconds

        Pump.refreshStreamsID = setInterval(Pump.refreshStreams, 60000);

        // Connect to current server

        if (Pump.config.sockjs) {
            Pump.setupSocket();
        }

        Pump.ensureCred(function(err, cred) {

            var user, nickname, pair;

            if (err) {
                Pump.error(err.message);
                return;
            }

            nickname = Pump.getNickname();

            if (nickname) {

                user = new Pump.User({nickname: nickname});

                // FIXME: this only has client auth; get something with user auth (direct?)

                user.fetch({success: function(user, response) {

                    var sp, continueTo;

                    Pump.currentUser = user;
                    Pump.body.nav = new Pump.UserNav({el: ".navbar-inner .container",
                                                      model: Pump.currentUser});

                    Pump.body.nav.render();

                    // If we're on the login page, and there's a current
                    // user, redirect to the actual page

                    switch (window.location.pathname) {
                    case "/main/login":
                        Pump.body.content = new Pump.LoginContent();
                        continueTo = getContinueTo();
                        Pump.router.navigate(continueTo, true);
                        break;
                    case "/":
                        Pump.router.home();
                        break;
                    }
                }});
            }
        });
    });


    return Pump;

})(window._, window.$, window.Backbone);
