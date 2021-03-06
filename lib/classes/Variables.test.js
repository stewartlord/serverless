'use strict';

const path = require('path');
const proxyquire = require('proxyquire');
const YAML = require('js-yaml');
const expect = require('chai').expect;
const Variables = require('../../lib/classes/Variables');
const Utils = require('../../lib/classes/Utils');
const Serverless = require('../../lib/Serverless');
const sinon = require('sinon');
const testUtils = require('../../tests/utils');
const slsError = require('./Error');

describe('Variables', () => {
  describe('#constructor()', () => {
    const serverless = new Serverless();

    it('should attach serverless instance', () => {
      const variablesInstance = new Variables(serverless);
      expect(typeof variablesInstance.serverless.version).to.be.equal('string');
    });

    it('should not set variableSyntax in constructor', () => {
      const variablesInstance = new Variables(serverless);
      expect(variablesInstance.variableSyntax).to.be.equal(undefined);
    });
  });

  describe('#loadVariableSyntax()', () => {
    it('should set variableSyntax', () => {
      const serverless = new Serverless();

      serverless.service.provider.variableSyntax = '\\${{([\\s\\S]+?)}}';

      serverless.variables.loadVariableSyntax();
      expect(serverless.variables.variableSyntax).to.be.a('RegExp');
    });
  });

  describe('#populateService()', () => {
    it('should call populateProperty method', () => {
      const serverless = new Serverless();

      const populatePropertyStub = sinon
        .stub(serverless.variables, 'populateProperty').resolves();

      return serverless.variables.populateService().then(() => {
        expect(populatePropertyStub.called).to.equal(true);
        serverless.variables.populateProperty.restore();
      });
    });

    it('should use variableSyntax', () => {
      const serverless = new Serverless();

      const variableSyntax = '\\${{([\\s\\S]+?)}}';
      const fooValue = '${clientId()}';
      const barValue = 'test';

      serverless.service.provider.variableSyntax = variableSyntax;

      serverless.service.custom = {
        var: barValue,
      };

      serverless.service.resources = {
        foo: fooValue,
        bar: '${{self:custom.var}}',
      };

      return serverless.variables.populateService().then(() => {
        expect(serverless.service.provider.variableSyntax).to.equal(variableSyntax);
        expect(serverless.service.resources.foo).to.equal(fooValue);
        expect(serverless.service.resources.bar).to.equal(barValue);
      });
    });
  });

  describe('#populateProperty()', () => {
    it('should call overwrite if overwrite syntax provided', () => {
      const serverless = new Serverless();
      const property = 'my stage is ${opt:stage, self:provider.stage}';

      serverless.variables.loadVariableSyntax();

      const overwriteStub = sinon
        .stub(serverless.variables, 'overwrite').resolves('dev');
      const populateVariableStub = sinon
        .stub(serverless.variables, 'populateVariable').resolves('my stage is dev');

      return serverless.variables.populateProperty(property).then(newProperty => {
        expect(overwriteStub.called).to.equal(true);
        expect(populateVariableStub.called).to.equal(true);
        expect(newProperty).to.equal('my stage is dev');

        serverless.variables.overwrite.restore();
        serverless.variables.populateVariable.restore();
        return Promise.resolve();
      });
    });

    it('should call getValueFromSource if no overwrite syntax provided', () => {
      const serverless = new Serverless();
      const property = 'my stage is ${opt:stage}';

      serverless.variables.loadVariableSyntax();

      const getValueFromSourceStub = sinon
        .stub(serverless.variables, 'getValueFromSource').resolves('prod');
      const populateVariableStub = sinon
        .stub(serverless.variables, 'populateVariable')
        .resolves('my stage is prod');

      return serverless.variables.populateProperty(property).then(newProperty => {
        expect(getValueFromSourceStub.called).to.equal(true);
        expect(populateVariableStub.called).to.equal(true);
        expect(newProperty).to.equal('my stage is prod');

        serverless.variables.getValueFromSource.restore();
        serverless.variables.populateVariable.restore();
        return Promise.resolve();
      });
    });

    it('should run recursively if nested variables provided', () => {
      const serverless = new Serverless();
      const property = 'my stage is ${env:${opt.name}}';

      serverless.variables.loadVariableSyntax();

      const getValueFromSourceStub = sinon
        .stub(serverless.variables, 'getValueFromSource');
      const populateVariableStub = sinon
        .stub(serverless.variables, 'populateVariable');

      getValueFromSourceStub.onCall(0).resolves('stage');
      getValueFromSourceStub.onCall(1).resolves('dev');
      populateVariableStub.onCall(0).resolves('my stage is ${env:stage}');
      populateVariableStub.onCall(1).resolves('my stage is dev');

      return serverless.variables.populateProperty(property).then(newProperty => {
        expect(getValueFromSourceStub.callCount).to.equal(2);
        expect(populateVariableStub.callCount).to.equal(2);
        expect(newProperty).to.equal('my stage is dev');

        serverless.variables.getValueFromSource.restore();
        serverless.variables.populateVariable.restore();
      });
    });
  });

  describe('#populateVariable()', () => {
    it('should populate string variables as sub string', () => {
      const serverless = new Serverless();
      const valueToPopulate = 'dev';
      const matchedString = '${opt:stage}';
      const property = 'my stage is ${opt:stage}';

      return serverless.variables.populateVariable(property, matchedString, valueToPopulate)
        .then(newProperty => {
          expect(newProperty).to.equal('my stage is dev');
        });
    });

    it('should populate number variables as sub string', () => {
      const serverless = new Serverless();
      const valueToPopulate = 5;
      const matchedString = '${opt:number}';
      const property = 'your account number is ${opt:number}';

      return serverless.variables.populateVariable(property, matchedString, valueToPopulate)
        .then(newProperty => {
          expect(newProperty).to.equal('your account number is 5');
        });
    });

    it('should populate non string variables', () => {
      const serverless = new Serverless();
      const valueToPopulate = 5;
      const matchedString = '${opt:number}';
      const property = '${opt:number}';

      return serverless.variables.populateVariable(property, matchedString, valueToPopulate)
        .then(newProperty => {
          expect(newProperty).to.equal(5);
        });
    });

    it('should throw error if populating non string or non number variable as sub string', () => {
      const serverless = new Serverless();
      const valueToPopulate = {};
      const matchedString = '${opt:object}';
      const property = 'your account number is ${opt:object}';
      expect(() => serverless.variables
        .populateVariable(property, matchedString, valueToPopulate))
        .to.throw(Error);
    });
  });

  describe('#overwrite()', () => {
    it('should overwrite undefined and null values', () => {
      const serverless = new Serverless();
      const getValueFromSourceStub = sinon
        .stub(serverless.variables, 'getValueFromSource');

      getValueFromSourceStub.onCall(0).resolves(undefined);
      getValueFromSourceStub.onCall(1).resolves(null);
      getValueFromSourceStub.onCall(2).resolves('variableValue');

      return serverless.variables.overwrite('opt:stage,env:stage,self:provider.stage')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal('variableValue');
          expect(getValueFromSourceStub.callCount).to.equal(3);
          serverless.variables.getValueFromSource.restore();
        });
    });

    it('should overwrite empty object values', () => {
      const serverless = new Serverless();
      const getValueFromSourceStub = sinon
        .stub(serverless.variables, 'getValueFromSource');

      getValueFromSourceStub.onCall(0).resolves({});
      getValueFromSourceStub.onCall(1).resolves('variableValue');

      return serverless.variables.overwrite('opt:stage,env:stage').then(valueToPopulate => {
        expect(valueToPopulate).to.equal('variableValue');
        expect(getValueFromSourceStub.callCount).to.equal(2);
        serverless.variables.getValueFromSource.restore();
      });
    });

    it('should not overwrite 0 values', () => {
      const serverless = new Serverless();
      const getValueFromSourceStub = sinon
        .stub(serverless.variables, 'getValueFromSource');

      getValueFromSourceStub.onCall(0).resolves(0);
      getValueFromSourceStub.onCall(1).resolves('variableValue');
      getValueFromSourceStub.onCall(2).resolves('variableValue2');
      return serverless.variables.overwrite('opt:stage,env:stage,self:provider.stage')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal(0);
          serverless.variables.getValueFromSource.restore();
        });
    });

    it('should not overwrite false values', () => {
      const serverless = new Serverless();
      const getValueFromSourceStub = sinon
        .stub(serverless.variables, 'getValueFromSource');

      getValueFromSourceStub.onCall(0).resolves(false);
      getValueFromSourceStub.onCall(1).resolves('variableValue');
      getValueFromSourceStub.onCall(2).resolves('variableValue2');

      return serverless.variables.overwrite('opt:stage,env:stage,self:provider.stage')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal(false);
          serverless.variables.getValueFromSource.restore();
        });
    });

    it('should skip getting values once a value has been found', () => {
      const serverless = new Serverless();
      const getValueFromSourceStub = sinon
        .stub(serverless.variables, 'getValueFromSource');

      getValueFromSourceStub.onCall(0).resolves(undefined);
      getValueFromSourceStub.onCall(1).resolves('variableValue');
      getValueFromSourceStub.onCall(2).resolves('variableValue2');

      return serverless.variables.overwrite('opt:stage,env:stage,self:provider.stage')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal('variableValue');
          serverless.variables.getValueFromSource.restore();
        });
    });
  });

  describe('#getValueFromSource()', () => {
    it('should call getValueFromEnv if referencing env var', () => {
      const serverless = new Serverless();
      const getValueFromEnvStub = sinon
        .stub(serverless.variables, 'getValueFromEnv').resolves('variableValue');
      return serverless.variables.getValueFromSource('env:TEST_VAR')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal('variableValue');
          expect(getValueFromEnvStub.called).to.equal(true);
          expect(getValueFromEnvStub.calledWith('env:TEST_VAR')).to.equal(true);
          serverless.variables.getValueFromEnv.restore();
        });
    });

    it('should call getValueFromOptions if referencing an option', () => {
      const serverless = new Serverless();
      const getValueFromOptionsStub = sinon
        .stub(serverless.variables, 'getValueFromOptions')
        .resolves('variableValue');

      return serverless.variables.getValueFromSource('opt:stage')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal('variableValue');
          expect(getValueFromOptionsStub.called).to.equal(true);
          expect(getValueFromOptionsStub.calledWith('opt:stage')).to.equal(true);
          serverless.variables.getValueFromOptions.restore();
        });
    });

    it('should call getValueFromSelf if referencing from self', () => {
      const serverless = new Serverless();
      const getValueFromSelfStub = sinon
        .stub(serverless.variables, 'getValueFromSelf').resolves('variableValue');

      return serverless.variables.getValueFromSource('self:provider')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal('variableValue');
          expect(getValueFromSelfStub.called).to.equal(true);
          expect(getValueFromSelfStub.calledWith('self:provider')).to.equal(true);
          serverless.variables.getValueFromSelf.restore();
        });
    });

    it('should call getValueFromFile if referencing from another file', () => {
      const serverless = new Serverless();
      const getValueFromFileStub = sinon
        .stub(serverless.variables, 'getValueFromFile').resolves('variableValue');

      return serverless.variables.getValueFromSource('file(./config.yml)')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal('variableValue');
          expect(getValueFromFileStub.called).to.equal(true);
          expect(getValueFromFileStub.calledWith('file(./config.yml)')).to.equal(true);
          serverless.variables.getValueFromFile.restore();
        });
    });

    it('should throw error if referencing an invalid source', () => {
      const serverless = new Serverless();
      expect(() => serverless.variables.getValueFromSource('weird:source'))
        .to.throw(Error);
    });
  });

  describe('#getValueFromEnv()', () => {
    it('should get variable from environment variables', () => {
      const serverless = new Serverless();
      process.env.TEST_VAR = 'someValue';
      return serverless.variables.getValueFromEnv('env:TEST_VAR').then(valueToPopulate => {
        expect(valueToPopulate).to.be.equal('someValue');
        delete process.env.TEST_VAR;
      });
    });

    it('should allow top-level references to the environment variables hive', () => {
      const serverless = new Serverless();
      process.env.TEST_VAR = 'someValue';
      return serverless.variables.getValueFromEnv('env:').then(valueToPopulate => {
        expect(valueToPopulate.TEST_VAR).to.be.equal('someValue');
        delete process.env.TEST_VAR;
      });
    });
  });

  describe('#getValueFromOptions()', () => {
    it('should get variable from options', () => {
      const serverless = new Serverless();
      serverless.variables.options = {
        stage: 'prod',
      };
      return serverless.variables.getValueFromOptions('opt:stage').then(valueToPopulate => {
        expect(valueToPopulate).to.be.equal('prod');
      });
    });

    it('should allow top-level references to the options hive', () => {
      const serverless = new Serverless();
      serverless.variables.options = {
        stage: 'prod',
      };
      return serverless.variables.getValueFromOptions('opt:').then(valueToPopulate => {
        expect(valueToPopulate.stage).to.be.equal('prod');
      });
    });
  });

  describe('#getValueFromSelf()', () => {
    it('should get variable from self serverless.yml file', () => {
      const serverless = new Serverless();
      serverless.variables.service = {
        service: 'testService',
        provider: serverless.service.provider,
      };
      serverless.variables.loadVariableSyntax();
      return serverless.variables.getValueFromSelf('self:service').then(valueToPopulate => {
        expect(valueToPopulate).to.be.equal('testService');
      });
    });

    it('should handle self-references to the root of the serverless.yml file', () => {
      const serverless = new Serverless();
      serverless.variables.service = {
        service: 'testService',
        provider: 'testProvider',
        defaults: serverless.service.defaults,
      };

      serverless.variables.loadVariableSyntax();

      return serverless.variables.getValueFromSelf('self:').then(valueToPopulate => {
        expect(valueToPopulate.provider).to.be.equal('testProvider');
      });
    });
  });

  describe('#getValueFromFile()', () => {
    it('should populate an entire variable file', () => {
      const serverless = new Serverless();
      const SUtils = new Utils();
      const tmpDirPath = testUtils.getTmpDirPath();
      const configYml = {
        test: 1,
        test2: 'test2',
        testObj: {
          sub: 2,
          prob: 'prob',
        },
      };

      SUtils.writeFileSync(path.join(tmpDirPath, 'config.yml'),
        YAML.dump(configYml));

      serverless.config.update({ servicePath: tmpDirPath });

      return serverless.variables.getValueFromFile('file(./config.yml)').then(valueToPopulate => {
        expect(valueToPopulate).to.deep.equal(configYml);
      });
    });

    it('should get undefined if non existing file and the second argument is true', () => {
      const serverless = new Serverless();
      const tmpDirPath = testUtils.getTmpDirPath();

      serverless.config.update({ servicePath: tmpDirPath });

      return serverless.variables.getValueFromFile('file(./config.yml)').then(valueToPopulate => {
        expect(valueToPopulate).to.be.equal(undefined);
      });
    });

    it('should populate non json/yml files', () => {
      const serverless = new Serverless();
      const SUtils = new Utils();
      const tmpDirPath = testUtils.getTmpDirPath();

      SUtils.writeFileSync(path.join(tmpDirPath, 'someFile'),
        'hello world');

      serverless.config.update({ servicePath: tmpDirPath });

      return serverless.variables.getValueFromFile('file(./someFile)').then(valueToPopulate => {
        expect(valueToPopulate).to.equal('hello world');
      });
    });

    it('should trim trailing whitespace and new line character', () => {
      const serverless = new Serverless();
      const SUtils = new Utils();
      const tmpDirPath = testUtils.getTmpDirPath();

      SUtils.writeFileSync(path.join(tmpDirPath, 'someFile'),
        'hello world \n');

      serverless.config.update({ servicePath: tmpDirPath });

      return serverless.variables.getValueFromFile('file(./someFile)').then(valueToPopulate => {
        expect(valueToPopulate).to.equal('hello world');
      });
    });

    it('should populate from another file when variable is of any type', () => {
      const serverless = new Serverless();
      const SUtils = new Utils();
      const tmpDirPath = testUtils.getTmpDirPath();
      const configYml = {
        test: 1,
        test2: 'test2',
        testObj: {
          sub: 2,
          prob: 'prob',
        },
      };

      SUtils.writeFileSync(path.join(tmpDirPath, 'config.yml'),
        YAML.dump(configYml));

      serverless.config.update({ servicePath: tmpDirPath });

      return serverless.variables.getValueFromFile('file(./config.yml):testObj.sub')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal(2);
        });
    });

    it('should populate from a javascript file', () => {
      const serverless = new Serverless();
      const SUtils = new Utils();
      const tmpDirPath = testUtils.getTmpDirPath();
      const jsData = 'module.exports.hello=function(){return "hello world";};';

      SUtils.writeFileSync(path.join(tmpDirPath, 'hello.js'), jsData);

      serverless.config.update({ servicePath: tmpDirPath });

      return serverless.variables.getValueFromFile('file(./hello.js):hello')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal('hello world');
        });
    });

    it('should populate deep object from a javascript file', () => {
      const serverless = new Serverless();
      const SUtils = new Utils();
      const tmpDirPath = testUtils.getTmpDirPath();
      const jsData = `module.exports.hello=function(){
        return {one:{two:{three: 'hello world'}}}
      };`;

      SUtils.writeFileSync(path.join(tmpDirPath, 'hello.js'), jsData);

      serverless.config.update({ servicePath: tmpDirPath });
      serverless.variables.loadVariableSyntax();

      return serverless.variables.getValueFromFile('file(./hello.js):hello.one.two.three')
        .then(valueToPopulate => {
          expect(valueToPopulate).to.equal('hello world');
        });
    });

    it('should throw error if not using ":" syntax', () => {
      const serverless = new Serverless();
      const SUtils = new Utils();
      const tmpDirPath = testUtils.getTmpDirPath();
      const configYml = {
        test: 1,
        test2: 'test2',
        testObj: {
          sub: 2,
          prob: 'prob',
        },
      };

      SUtils.writeFileSync(path.join(tmpDirPath, 'config.yml'),
        YAML.dump(configYml));

      serverless.config.update({ servicePath: tmpDirPath });

      expect(() => serverless.variables
        .getValueFromFile('file(./config.yml).testObj.sub')).to.throw(Error);
    });
  });

  describe('#getDeepValue()', () => {
    it('should get deep values', () => {
      const serverless = new Serverless();

      const valueToPopulateMock = {
        service: 'testService',
        custom: {
          subProperty: {
            deep: 'deepValue',
          },
        },
      };

      serverless.variables.loadVariableSyntax();

      return serverless.variables.getDeepValue(['custom', 'subProperty', 'deep'],
        valueToPopulateMock).then(valueToPopulate => {
          expect(valueToPopulate).to.be.equal('deepValue');
        });
    });

    it('should not throw error if referencing invalid properties', () => {
      const serverless = new Serverless();

      const valueToPopulateMock = {
        service: 'testService',
        custom: {
          subProperty: 'hello',
        },
      };

      serverless.variables.loadVariableSyntax();

      return serverless.variables.getDeepValue(['custom', 'subProperty', 'deep', 'deeper'],
        valueToPopulateMock).then(valueToPopulate => {
          expect(valueToPopulate).to.deep.equal({});
        });
    });

    it('should get deep values with variable references', () => {
      const serverless = new Serverless();

      serverless.variables.service = {
        service: 'testService',
        custom: {
          anotherVar: '${self:custom.var}',
          subProperty: {
            deep: '${self:custom.anotherVar.veryDeep}',
          },
          var: {
            veryDeep: 'someValue',
          },
        },
        provider: serverless.service.provider,
      };

      serverless.variables.loadVariableSyntax();

      return serverless.variables.getDeepValue(['custom', 'subProperty', 'deep'],
        serverless.variables.service).then(valueToPopulate => {
          expect(valueToPopulate).to.be.equal('someValue');
        });
    });
  });

  describe('#warnIfNotFound()', () => {
    let logWarningSpy;
    let consoleLogStub;
    let varProxy;

    beforeEach(() => {
      logWarningSpy = sinon.spy(slsError, 'logWarning');
      consoleLogStub = sinon.stub(console, 'log').returns();
      const ProxyQuiredVariables = proxyquire('./Variables.js', {
        './Error': logWarningSpy,
      });
      varProxy = new ProxyQuiredVariables(new Serverless());
    });

    afterEach(() => {
      logWarningSpy.restore();
      consoleLogStub.restore();
    });

    it('should do nothing if variable has valid value.', () => {
      varProxy.warnIfNotFound('self:service', 'a-valid-value');
      expect(logWarningSpy.calledOnce).to.be.equal(false);
    });

    it('should log if variable has null value.', () => {
      varProxy.warnIfNotFound('self:service', null);
      expect(logWarningSpy.calledOnce).to.be.equal(true);
    });

    it('should log if variable has undefined value.', () => {
      varProxy.warnIfNotFound('self:service', undefined);
      expect(logWarningSpy.calledOnce).to.be.equal(true);
    });

    it('should log if variable has empty object value.', () => {
      varProxy.warnIfNotFound('self:service', {});
      expect(logWarningSpy.calledOnce).to.be.equal(true);
    });

    it('should detect the "environment variable" variable type', () => {
      varProxy.warnIfNotFound('env:service', null);
      expect(logWarningSpy.calledOnce).to.be.equal(true);
      expect(logWarningSpy.args[0][0]).to.contain('environment variable');
    });

    it('should detect the "option" variable type', () => {
      varProxy.warnIfNotFound('opt:service', null);
      expect(logWarningSpy.calledOnce).to.be.equal(true);
      expect(logWarningSpy.args[0][0]).to.contain('option');
    });

    it('should detect the "service attribute" variable type', () => {
      varProxy.warnIfNotFound('self:service', null);
      expect(logWarningSpy.calledOnce).to.be.equal(true);
      expect(logWarningSpy.args[0][0]).to.contain('service attribute');
    });

    it('should detect the "file" variable type', () => {
      varProxy.warnIfNotFound('file(service)', null);
      expect(logWarningSpy.calledOnce).to.be.equal(true);
      expect(logWarningSpy.args[0][0]).to.contain('file');
    });
  });
});
