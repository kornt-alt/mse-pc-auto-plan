import React from 'react';
import { Container, Card } from 'react-bootstrap';

const About = () => {
  return (
    <Container className="py-4">
      <h1 className="text-center mb-4">Sawaddee kub</h1>
      <Card>
        <Card.Body>
          <Card.Title>Welcome to Our Mecha Kub!</Card.Title>
          <Card.Text>
            Test
          </Card.Text>
          <Card.Text>
            Create By Korn PE
          </Card.Text>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default About;