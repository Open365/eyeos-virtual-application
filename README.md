Eyeos Virtual Application Library
=================================

## Overview

This library manages virtual applications

## How to use it

var Application = require('eyeos-virtual-application').Application;

var launcher = new Application('192.168.5.14');
launcher.launch({name: "dolphin", user: 'eyeos'}, function(error, runninInfo) {
    console.log("Running app info", runninInfo);
});

## Quick help

* Install modules

```bash
	$ npm install
```

* Check tests

```bash
    $ ./tests.sh
```