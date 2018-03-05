#include <opencv2/opencv.hpp>
#include <opencv2/ccalib/randpattern.hpp>
#include <zmq.hpp>
#include <iostream>
#include <unistd.h>

using namespace std;
using namespace cv;
using namespace randpattern;

int main() {
  cout << "started okay" << endl;
  zmq::context_t context (1);
  zmq::socket_t socket (context, ZMQ_REP);

  socket.bind ("tcp://*:5555");
  RandomPatternGenerator generator = RandomPatternGenerator(3840, 2160);
  generator.generatePattern();
  
  Mat pattern = generator.getPattern();
  namedWindow("pattern", WND_PROP_FULLSCREEN);
  setWindowProperty("pattern", WND_PROP_FULLSCREEN, WINDOW_FULLSCREEN);
  imshow("pattern", pattern);
  waitKey(1);

  while(true) {
    cout << "waiting for request" << endl;

    zmq::message_t request;
    
    socket.recv (&request);
    std::cout << "Received Hello" << std::endl;

    sleep(1);

    zmq::message_t reply (5);
    memcpy (reply.data (), "World", 5);
    socket.send (reply);
  }

  return 0;
}
