# pump.io

Version 0.2.0-alpha.1

This is pump.io. It's a stream server that does most of what people
really want from a social network.

[![Build Status](https://secure.travis-ci.org/e14n/pump.io.png)](http://travis-ci.org/e14n/pump.io)

## License

Copyright 2011-2012, StatusNet Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

## What's it for?

I post something and my followers see it. That's the rough idea behind
the pump.

There's an API defined in the API.md file. It uses activitystrea.ms
JSON as the main data and command format.

You can post almost anything that can be represented with activity
streams -- short or long text, bookmarks, images, video, audio,
events, geo checkins. You can follow friends, create lists of people,
and so on.

The software is useful for at least these scenarios:

* Mobile-first social networking
* Activity stream functionality for an existing app
* Experimenting with social software

Version 0.2.0 will have a Web UI, which will probably make the whole
thing much more enjoyable.

## Installation

You'll need three things to get started:

* node.js 0.8.0 or higher
* npm 1.1.0 or higher
* A database server (see below)

The easiest way is to install the software globally using npm, like
so:

    npm install -g pump.io

That should set up all the files and dependencies for you.

### Local install

If you want to set up the software in its own directory, you can clone
the git repository, so:

    git clone https://github.com/e14n/pump.io.git
    
You can then install the dependencies using `npm`:

    cd pump.io
    npm install

To test the install, run:

    npm test
    
### Database setup

pump.io uses [databank](https://github.com/evanp/databank)
package to abstract out the data storage for the system. Any databank
driver should work. Couchbase, MongoDB and Redis are probably the best
bets for production servers, but the `disk` or even `memory` drivers
can work for testing.

If you're confused, just use the MongoDB one, `databank-mongodb`.

You can find other drivers like so:

    npm search databank

One tricky bit is that the driver you use has to be available to the
`databank` package. There are two ways to make that work.

First, you can install globally. For example:

    npm install -g databank-mongodb

Use this if you installed the pump.io package globally.

Second, you can install in the `databank` directory.

    cd pump.io/node_modules/databank
    npm install databank-mongodb

Note that you also need to install and configure your database server.

### Configuration

pump.io uses a JSON file for configuration. It should be at
`/etc/pump.io.json`.

The `pump.io.json.sample` file should give you an idea of how to use
it.

Here are the main configuration keys.

* *driver* The databank driver you're using. Defaults to "disk", which
  is probably going to be terrible.
* *params* Databank driver params; see the databank driver README for
   details on what to put here.
* *hostname* The hostname of the server. Defaults to "localhost" which
   doesn't do much for you.
* *address* The address to listen on. Defaults to `hostname`, which is
   OK for most systems. Use this if you've got some kind of
   load-balancer or NAS or whatever and your local IP doesn't map to
   the IP of the hostname.
* *port* Port to listen on. Defaults to 31337, which is no good. You
   should listen on 80 or 443 if you're going to have anyone use this.
* *secret* A session-generating secret, server-wide password.
* *noweb* Hide the Web interface. Since it's disabled for this release,
  this shouldn't cause you any problems.
* *site* Name of the server, like "My great social service".
* *owner* Name of owning entity, if you want to link to it.
* *ownerURL* URL of owning entity, if you want to link to it.
* *nologger* If you're debugging or whatever, turn off
  logging. Defaults to false (leave logging on).
* *serverUser* If you're listening on a port lower than 1024, you need
  to be root. Set this to the name of a user to change to after the
  server is listening. `daemon` or `nobody` are good choices, or you
  can create a user like `pump` and use that.
* *key* If you're using SSL, the path to the server key, like
   "/etc/ssl/private/myserver.key".
* *cert* If you're using SSL, the path to the server cert, like
   "/etc/ssl/private/myserver.crt".
* *uploaddir* If you want to enable file uploads, set this to the
  full path of a local directory. It should be writeable and readable by the 
  'serverUser'.

## Bugs

If you find bugs, you can report them here:

https://github.com/e14n/pump.io/issues

You can also email me at evan@e14n.com.
