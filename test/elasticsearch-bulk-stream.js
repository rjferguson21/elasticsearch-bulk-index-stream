'use strict';

var chai = require('chai'),
    sinon = require('sinon'),
    sinonChai = require('sinon-chai'),
    clone = require('clone'),
    ElasticsearchBulkIndexWritable = require('../');

chai.use(sinonChai);

var expect = chai.expect;

var recordFixture = require('./fixture/record.json');
var successResponseFixture = require('./fixture/success-response.json');
var errorResponseFixture = require('./fixture/error-response.json');

describe('ElastisearchBulkIndexWritable', function() {
    beforeEach(function() {
        this.sinon = sinon.sandbox.create();
    });

    afterEach(function() {
        this.sinon.restore();
    });

    describe('constructor', function() {
        it('should require client', function() {
            expect(function() {
                new ElasticsearchBulkIndexWritable();
            }).to.Throw(Error, 'client is required');
        });

        it('should default highWaterMark to 16', function() {
            var stream = new ElasticsearchBulkIndexWritable({});

            expect(stream.highWaterMark).to.eq(16);
        });
    });

    describe('queue', function() {
        beforeEach(function() {
            this.stream = new ElasticsearchBulkIndexWritable({}, { highWaterMark: 10 });
        });

        it('should queue up number of items equal to highWaterMark', function(done) {
            this.sinon.stub(this.stream, '_flush').yields();

            for (var i = 0; i < 8; i++) {
                this.stream.write(recordFixture);
            }

            this.stream.write(recordFixture, function() {
                expect(this.stream._flush).to.not.have.been.called;

                this.stream.write(recordFixture, function() {
                    expect(this.stream._flush).to.have.been.calledOnce;

                    done();
                }.bind(this));
            }.bind(this));
        });

        it('should flush queue if stream is closed', function(done) {
            this.sinon.stub(this.stream, '_flush').yields();

            this.stream.end(recordFixture, function() {
                expect(this.stream._flush).to.have.been.calledOnce;

                done();
            }.bind(this));
        });
    });

    describe('flushing', function() {
        function getMissingFieldTest(fieldName) {
            return function(done) {
                this.stream.on('error', function(error) {
                    expect(error).to.be.instanceOf(Error);
                    expect(error.message).to.eq(fieldName + ' is required');

                    done();
                });

                var fixture = clone(recordFixture);
                delete fixture[fieldName];

                this.stream.end(fixture);
            };
        }

        beforeEach(function() {
            this.client = {
                bulk: this.sinon.stub()
            };

            this.stream = new ElasticsearchBulkIndexWritable(this.client, {
                highWaterMark: 6
            });
        });

        it('should write records to elasticsearch', function(done) {
            this.client.bulk.yields(null, successResponseFixture);

            this.stream.end(recordFixture, function() {
                expect(this.client.bulk).to.have.been.called;

                done();
            }.bind(this));
        });

        it('should do nothing if there is nothing in the queue when the stream is closed', function(done) {
            this.client.bulk.yields(null, successResponseFixture);

            this.stream.on('finish', function() {
                expect(this.client.bulk).to.have.been.calledOnce;

                done();
            }.bind(this));

            for (var i = 0; i < 6; i++) {
                this.stream.write(recordFixture);
            }

            this.stream.end();
        });

        it('should trigger error on elasticsearch error', function(done) {
            this.client.bulk.yields(new Error('Fail'));

            this.stream.on('error', function(error) {
                expect(error.message).to.eq('Fail');

                done();
            });

            this.stream.end(recordFixture);
        });

        it('should trigger error on bulk errors', function(done) {
            this.client.bulk.yields(null, errorResponseFixture);

            this.stream.on('error', function(error) {
                expect(error).to.be.instanceOf(Error);
                expect(error.message).to.deep.eq('InternalServerError,Forbidden');

                done();
            });

            this.stream.write(recordFixture);
            this.stream.end(recordFixture);
        });

        it('should throw error on index missing in record', getMissingFieldTest('index'));

        it('should throw error on type missing in record', getMissingFieldTest('type'));

        it('should throw error on body missing in record', getMissingFieldTest('body'));
    });
    describe('timeout', function() {
        beforeEach(function() {
            this.client = {
                bulk: this.sinon.stub()
            };

            this.stream = new ElasticsearchBulkIndexWritable(this.client, {
                highWaterMark: 10,
                timeout: 10
            });
        });

        it('should write records to elasticsearch', function(done) {
            this.client.bulk.yields(null, successResponseFixture);

            this.stream.end(recordFixture, function() {
                expect(this.client.bulk).to.have.been.called;

                done();
            }.bind(this));
        });

        it('should flush queue if there is something in the queue after timeout', function(done) {
            this.client.bulk.yields(null, successResponseFixture);
            var self = this;
            var write = function(n) {
                for (var i = 0; i < n; i++) {
                    self.stream.write(recordFixture);
                }
            };

            setTimeout(function() {
                expect(self.client.bulk.callCount).to.eq(10);
                done();
            }, 40);

            write(95);
            expect(self.client.bulk.callCount).to.eq(9);
        });

        it('should emit flush event when data is written', function(done) {
            this.client.bulk.yields(null, successResponseFixture);
            var self = this;
            var write = function(n) {
                for (var i = 0; i < n; i++) {
                    self.stream.write(recordFixture);
                }
            };

            this.stream.on('flush', function(flush) {
                expect(flush.writtenRecords).to.eq(self.stream.writtenRecords);
                if (flush.writtenRecords === 95) {
                    done();
                }
            });

            write(95);
            expect(self.client.bulk.callCount).to.eq(9);

            setTimeout(function() {
                expect(self.client.bulk.callCount).to.eq(10);
            }, 40);
        });

        it.only('should only remove from queue the size it writes', function(done) {
            this.client.bulk.yields(null, successResponseFixture);
            var self = this;
            var write = function(n) {
                for (var i = 0; i < n; i++) {
                    self.stream.write(recordFixture);
                }
            };

            write(5);
            setTimeout(function() {
                expect(self.stream.queue.length).to.eq(0);
                write(15);
                expect(self.client.bulk.callCount).to.eq(2);
                expect(self.stream.queue.length).to.eq(5);
                done();
            }, 20);
        });
    });
});
